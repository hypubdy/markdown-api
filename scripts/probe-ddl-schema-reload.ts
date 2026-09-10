#!/usr/bin/env node
/**
 * TÁI HIỆN: DDL lúc khởi động ⇒ PostgREST reload schema cache ⇒ request bị treo vài giây.
 *
 * Cơ chế:
 *   1. App chạy `bootstrapSupabaseSchema()` (CREATE TABLE IF NOT EXISTS…) MỖI LẦN khởi động
 *      — và `npm run dev` dùng `tsx watch` nên khởi động lại MỖI LẦN LƯU FILE.
 *   2. Supabase có event trigger (pgrst_ddl_watch) → DDL xong là `NOTIFY pgrst, 'reload schema'`.
 *   3. PostgREST reload schema cache = chạy query "introspection" rất nặng
 *      (đo được mean 891ms, max 6450ms trong pg_stat_statements).
 *   4. Trong lúc đó, request của app phải chờ ⇒ 6 giây cho một query LIMIT 1.
 *
 * Script này: bắn request (đo nền) → chạy ĐÚNG đoạn DDL của app → bắn tiếp và xem độ trễ.
 * DDL ở đây là idempotent (IF NOT EXISTS) và chính là thứ app vẫn chạy, nên an toàn.
 *
 *   tsx scripts/probe-ddl-schema-reload.ts
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import pg from "pg";
import https from "node:https";

const t = readFileSync(new URL("../.env", import.meta.url), "utf8");
const all = (k) => [...t.matchAll(new RegExp(`^${k}=(.*)$`, "gm"))].map((m) => m[1].trim());
const restHost = new URL(all("SUPABASE_URL")[0]).host;
const key = all("SUPABASE_SERVICE_ROLE_KEY")[0];
const ref = restHost.split(".")[0];
const dbUrl = `postgresql://postgres:VaWntuhy%402719@db.${ref}.supabase.co:5432/postgres`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (s) => console.log(`\n${"─".repeat(78)}\n${s}\n${"─".repeat(78)}`);

/** Đúng đoạn DDL mà src/data/supabase.bootstrap.ts chạy lúc khởi động. */
const APP_DDL = readFileSync(new URL("../src/data/supabase.bootstrap.ts", import.meta.url), "utf8")
  .match(/SUPABASE_SCHEMA_SQL = `([\s\S]*?)`;/)[1];

const INTROSPECTION = "%n.nspname AS schema%";

const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });
const restQuery = () =>
  new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.request(
      { host: restHost, path: "/rest/v1/notes?select=id&limit=1", method: "GET", agent, headers: { apikey: key, Authorization: `Bearer ${key}` } },
      (res) => {
        const ttfb = performance.now() - t0;
        res.resume();
        res.on("end", () =>
          resolve({ ttfb, upstream: Number(res.headers["x-envoy-upstream-service-time"] ?? 0), status: res.statusCode }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });

const introspectionCalls = async (db) =>
  Number((await db.query(`SELECT coalesce(sum(calls),0) AS n FROM pg_stat_statements WHERE query LIKE $1`, [INTROSPECTION])).rows[0].n);

async function fire(db, label, n, gapMs) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const before = await introspectionCalls(db);
    const r = await restQuery();
    const after = await introspectionCalls(db);
    out.push({ ...r, reloaded: after > before });
    await sleep(gapMs);
  }
  console.log(`\n▸ ${label}`);
  for (const [i, r] of out.entries()) {
    const flag = r.reloaded ? "  ← vừa có RELOAD SCHEMA" : "";
    console.log(
      `   #${String(i + 1).padStart(2)}  TTFB=${`${r.ttfb.toFixed(0)}ms`.padStart(8)}  Supabase xử lý=${`${r.upstream}ms`.padStart(6)}  [${r.status}]${flag}`,
    );
  }
  const med = [...out.map((r) => r.ttfb)].sort((a, b) => a - b)[Math.floor(out.length / 2)];
  console.log(`   → trung vị TTFB: ${med.toFixed(0)}ms`);
  return out;
}

async function main() {
  const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  await db.connect();
  console.log(`\n▶ Tái hiện DDL → schema reload @ ${ref}  (${new Date().toISOString()})`);

  line("1. SUPABASE CÓ BẮT DDL ĐỂ RELOAD SCHEMA KHÔNG?");
  const et = await db.query(`SELECT evtname, evtevent, evtenabled, evtfoid::regproc AS func FROM pg_event_trigger ORDER BY evtname`);
  if (et.rows.length === 0) console.log("   (không có event trigger nào)");
  else {
    for (const r of et.rows) console.log(`   ${r.evtname.padEnd(22)} on ${r.evtevent.padEnd(18)} enabled=${r.evtenabled}  → ${r.func}`);
  }

  const base = await introspectionCalls(db);
  console.log(`\n   Số lần query introspection (reload schema cache) đã chạy: ${base}`);

  line("2. ĐỘ TRỄ NỀN (trước khi chạy DDL)");
  await fire(db, "5 request bình thường", 5, 100);

  line("3. CHẠY ĐÚNG ĐOẠN DDL MÀ APP CHẠY LÚC KHỞI ĐỘNG");
  console.log("   (CREATE TABLE/INDEX IF NOT EXISTS — y hệt src/data/supabase.bootstrap.ts)");
  const t0 = performance.now();
  await db.query(APP_DDL);
  console.log(`   DDL xong sau ${(performance.now() - t0).toFixed(0)}ms`);

  line("4. ĐỘ TRỄ NGAY SAU DDL (mô phỏng request đầu tiên sau khi restart server)");
  const after = await fire(db, "10 request liên tiếp sau DDL", 10, 150);

  const afterCalls = await introspectionCalls(db);
  console.log(`\n   Số lần reload schema sau thí nghiệm: ${afterCalls} (tăng ${afterCalls - base})`);

  line("5. DDL THẬT (tạo rồi xoá 1 bảng tạm) — reload schema có thật sự tốn kém?");
  const beforeReal = await introspectionCalls(db);
  const t1 = performance.now();
  await db.query(`CREATE TABLE IF NOT EXISTS public.zz_probe_schema_reload (id int)`);
  const ddlMs = performance.now() - t1;
  const real = await fire(db, "8 request ngay sau DDL thật", 8, 250);
  const afterReal = await introspectionCalls(db);
  await db.query(`DROP TABLE IF EXISTS public.zz_probe_schema_reload`);
  const afterDrop = await introspectionCalls(db);

  console.log(`\n   DDL thật xong sau ${ddlMs.toFixed(0)}ms`);
  console.log(`   Reload schema: trước=${beforeReal} → sau CREATE=${afterReal} → sau DROP=${afterDrop}`);
  const worstReal = Math.max(...real.map((r) => r.ttfb));
  console.log(`   Request xấu nhất sau DDL thật: ${worstReal.toFixed(0)}ms`);

  console.log("");
}

main().catch((e) => {
  console.error("lỗi:", e.message);
  process.exit(1);
});
