#!/usr/bin/env node
/**
 * PROBE POSTGRES (pg) — so sánh đường đi thay thế cho PostgREST.
 * Đo: connect, và thời gian query đơn giản nhất, qua:
 *   - DATABASE_URL trong .env (thường là pooler aws-1-ap-southeast-1.pooler.supabase.com:5432)
 *   - host trực tiếp db.<ref>.supabase.co:5432
 *
 * Mục đích: xác định độ trễ nằm ở PostgREST hay ở Postgres/đường mạng tới DB.
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import pg from "pg";

const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
const envOf = (key) => {
  const m = envText.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : undefined;
};

const poolerUrl = envOf("DATABASE_URL");
const host = new URL(envOf("SUPABASE_URL")).host;
const ref = host.split(".")[0];
const directUrl = `postgresql://postgres:VaWntuhy%402719@db.${ref}.supabase.co:5432/postgres`;

const stat = (label, times) => {
  const s = [...times].sort((a, b) => a - b);
  console.log(
    `${label.padEnd(46)} min=${s[0].toFixed(1)}ms  median=${s[Math.min(s.length - 1, Math.floor(s.length / 2))].toFixed(1)}ms  max=${s[s.length - 1].toFixed(1)}ms`,
  );
};

async function probe(label, connectionString) {
  console.log(`\n── ${label}\n   ${connectionString?.replace(/:[^:@]*@/, ":****@")}`);
  if (!connectionString) return console.log("   (bỏ qua: không có URL)");
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  const t0 = performance.now();
  try {
    await client.connect();
  } catch (e) {
    console.log(`   ❌ connect lỗi: ${e.message}`);
    return;
  }
  const connectMs = performance.now() - t0;

  const times = [];
  for (let i = 0; i < 8; i++) {
    const t = performance.now();
    await client.query("SELECT id FROM notes LIMIT 1");
    times.push(performance.now() - t);
  }
  console.log(`   connect = ${connectMs.toFixed(1)}ms`);
  stat("   SELECT id FROM notes LIMIT 1", times);
  await client.end().catch(() => {});
}

async function main() {
  console.log("▶ Probe so sánh PostgREST vs Postgres trực tiếp\n");
  await probe("POOLER (DATABASE_URL trong .env)", poolerUrl);
  await probe("DIRECT db.<ref>.supabase.co", directUrl);
  console.log(
    "\n💡 So sánh với PostgREST: mỗi query PostgREST ~230–390ms (xem probe-supabase.ts).",
  );
}

main().catch((e) => {
  console.error("probe-pg lỗi:", e);
  process.exit(1);
});
