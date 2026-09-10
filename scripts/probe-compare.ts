#!/usr/bin/env node
/**
 * SO SÁNH 3 ĐƯỜNG ĐI trong cùng một phút — tách biệt từng biến số:
 *   A. PostgREST HTTPS  (app đang dùng)  → Cloudflare edge → origin
 *   B. Postgres TRỰC TIẾP  db.<ref>.supabase.co:5432
 *   C. Postgres qua POOLER  aws-1-<region>.pooler.supabase.com:5432
 *
 * Với B/C in riêng: thời gian connect (1 lần) và thời gian query (connection đã ấm).
 * Với A in riêng: TTFB client thấy, thời gian Supabase tự báo, và phần chênh (= mạng).
 *
 *   tsx scripts/probe-compare.ts
 */
import { readFileSync } from "node:fs";
import https from "node:https";
import net from "node:net";
import { performance } from "node:perf_hooks";
import pg from "pg";

const t = readFileSync(new URL("../.env", import.meta.url), "utf8");
const all = (k) => [...t.matchAll(new RegExp(`^${k}=(.*)$`, "gm"))].map((m) => m[1].trim());
const host = new URL(all("SUPABASE_URL")[0]).host;
const ref = host.split(".")[0];
const key = all("SUPABASE_SERVICE_ROLE_KEY")[0];
const dbUrls = all("DATABASE_URL");
const poolerUrl = dbUrls.find((u) => u.includes("pooler"));
const directUrl = `postgresql://postgres:VaWntuhy%402719@db.${ref}.supabase.co:5432/postgres`;

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const fmt = (n) => `${Number(n).toFixed(0)}ms`.padStart(9);
const hidePw = (u) => u?.replace(/:[^:@]*@/, ":****@") ?? "(không có)";

// ── A. PostgREST ──────────────────────────────────────────────────────────────
const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });
const rest = () =>
  new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.request(
      { host, path: "/rest/v1/notes?select=id&limit=1", method: "GET", agent, headers: { apikey: key, Authorization: `Bearer ${key}` } },
      (res) => {
        const ttfb = performance.now() - t0;
        res.resume();
        res.on("end", () => resolve({ ms: ttfb, upstream: Number(res.headers["x-envoy-upstream-service-time"] ?? 0) }));
      },
    );
    req.on("error", reject);
    req.end();
  });

async function benchRest(n = 10) {
  await rest(); // warm keep-alive
  const xs = [];
  const ups = [];
  for (let i = 0; i < n; i++) {
    const r = await rest();
    xs.push(r.ms);
    ups.push(r.upstream);
  }
  return { median: med(xs), max: Math.max(...xs), upstream: med(ups) };
}

// ── B/C. pg ───────────────────────────────────────────────────────────────────
async function benchPg(connectionString, n = 10) {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  const t0 = performance.now();
  await client.connect();
  const connect = performance.now() - t0;
  const xs = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await client.query("SELECT id FROM notes LIMIT 1");
    xs.push(performance.now() - t);
  }
  await client.end().catch(() => {});
  return { connect, median: med(xs), max: Math.max(...xs) };
}

async function main() {
  console.log(`\n▶ Cùng lúc, cùng một query: "SELECT id FROM notes LIMIT 1"\n`);
  console.log(`   B: ${hidePw(directUrl)}`);
  console.log(`   C: ${hidePw(poolerUrl)}\n`);
  console.log(`${"đường đi".padEnd(50)} ${"connect".padStart(9)} ${"query TV".padStart(9)} ${"query max".padStart(10)}`);
  console.log("-".repeat(82));

  const a = await benchRest(10);
  console.log(
    `${"A. PostgREST HTTPS (app đang dùng)".padEnd(50)} ${"(keep-alive)".padStart(9)} ${fmt(a.median)} ${fmt(a.max)}`,
  );

  const b = await benchPg(directUrl, 10);
  console.log(`${"B. pg trực tiếp db.<ref>.supabase.co".padEnd(50)} ${fmt(b.connect)} ${fmt(b.median)} ${fmt(b.max)}`);

  let c = null;
  if (poolerUrl) {
    c = await benchPg(poolerUrl, 10);
    console.log(`${"C. pg qua pooler aws-1-…pooler.supabase.com".padEnd(50)} ${fmt(c.connect)} ${fmt(c.median)} ${fmt(c.max)}`);
  }

  const transport = a.median - a.upstream;
  console.log("\n" + "-".repeat(82));
  console.log(`A phân rã: TTFB ${a.median.toFixed(0)}ms = mạng ${transport.toFixed(0)}ms + Supabase xử lý ${a.upstream.toFixed(0)}ms`);
  console.log(`           (Supabase xử lý ở đây là con số CHÍNH Supabase báo qua header x-envoy-upstream-service-time)`);
  console.log(`\n➡️  A/B = ${(a.median / b.median).toFixed(1)}× trên cùng một query, cùng một DB.`);
  console.log(`➡️  Riêng chặng mạng của A (${transport.toFixed(0)}ms) đã gấp ~${(transport / b.median).toFixed(1)}× cả một query Postgres trực tiếp (${b.median.toFixed(0)}ms).\n`);
}

main().catch((e) => {
  console.error("lỗi:", e.message);
  process.exit(1);
});
