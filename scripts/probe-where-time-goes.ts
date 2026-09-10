#!/usr/bin/env node
/**
 * THỜI GIAN ĐI ĐÂU? — bài kiểm tra quyết định.
 *
 * Ý tưởng: bắn 1 request PostgREST, ĐỒNG THỜI hỏi thẳng Postgres (qua pg) xem
 * connection của PostgREST ("authenticator") đang ở trạng thái nào, query gì.
 *
 *   - Nếu trong ~1 giây đó connection phần lớn là `idle`  ⇒ Postgres KHÔNG bận,
 *     thời gian nằm ở PostgREST/gateway/pool.
 *   - Nếu connection `active` suốt                                          ⇒ Postgres mới là chỗ chậm.
 *
 * Kèm theo: pg_stat_statements (thời gian CHẠY THẬT của từng câu SQL trong DB)
 * và danh sách cron job (nếu có job nền ăn CPU thì cũng gây chậm).
 *
 *   tsx scripts/probe-where-time-goes.ts
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
const table = (rows, limit = 12) => {
  if (!rows.length) return console.log("   (không có dữ liệu)");
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  console.log("   " + cols.map((c, i) => c.padEnd(w[i])).join(" | "));
  console.log("   " + w.map((x) => "-".repeat(x)).join("-+-"));
  for (const row of rows.slice(0, limit)) {
    console.log("   " + cols.map((c, i) => String(row[c] ?? "").padEnd(w[i])).join(" | "));
  }
};

const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });
const restQuery = (path) =>
  new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.request(
      { host: restHost, path, method: "GET", agent, headers: { apikey: key, Authorization: `Bearer ${key}` } },
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

async function main() {
  const db = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await db.connect();
  console.log(`\n▶ Điều tra thời gian @ ${ref}  (${new Date().toISOString()})`);

  // ── A. pg_stat_statements ───────────────────────────────────────────────────
  line("A. THỜI GIAN CHẠY THẬT TRONG POSTGRES (pg_stat_statements)");
  const info = await db.query(`SELECT stats_reset FROM pg_stat_statements_info`).catch(() => ({ rows: [] }));
  if (info.rows[0]) console.log(`   Thống kê được reset lúc: ${info.rows[0].stats_reset}`);

  const top = await db.query(`
    SELECT calls,
           round(total_exec_time::numeric, 1)  AS tong_ms,
           round(mean_exec_time::numeric, 2)   AS tb_ms,
           round(max_exec_time::numeric, 1)    AS max_ms,
           round((100.0 * total_exec_time / nullif(sum(total_exec_time) OVER (), 0))::numeric, 1) AS pct,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 70) AS query
      FROM pg_stat_statements
     ORDER BY total_exec_time DESC
     LIMIT 12`);
  console.log("\n▸ Top 12 câu SQL theo TỔNG thời gian chạy trong DB");
  table(top.rows);

  const ours = await db.query(`
    SELECT calls,
           round(mean_exec_time::numeric, 2) AS tb_ms,
           round(max_exec_time::numeric, 1)  AS max_ms,
           round(total_exec_time::numeric, 1) AS tong_ms,
           left(regexp_replace(query, '\\s+', ' ', 'g'), 70) AS query
      FROM pg_stat_statements
     WHERE query ILIKE '%notes%' OR query ILIKE '%note_tags%' OR query ILIKE '%tags%' OR query ILIKE '%users%'
     ORDER BY total_exec_time DESC
     LIMIT 12`);
  console.log("\n▸ Các query liên quan notes/tags/users");
  table(ours.rows);

  // ── B. cron job nền ─────────────────────────────────────────────────────────
  line("B. JOB NỀN (pg_cron) — có gì chạy định kỳ ăn CPU không");
  const cron = await db.query(`SELECT jobid, schedule, command, active FROM cron.job ORDER BY jobid`).catch((e) => ({ rows: [], error: e.message }));
  if (cron.error) console.log(`   (không đọc được cron.job: ${cron.error})`);
  else table(cron.rows);

  // ── C. Lấy mẫu pg_stat_activity TRONG LÚC request PostgREST chạy ────────────
  line("C. TRONG LÚC POSTGREST CHẠY, POSTGRES CÓ BẬN KHÔNG?");
  console.log("   Bắn 1 request PostgREST, song song hỏi pg_stat_activity mỗi 40ms.\n");

  const samples = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      try {
        const { rows } = await db.query(`
          SELECT state, wait_event_type, wait_event,
                 round(extract(epoch FROM (now() - query_start))::numeric, 3) AS giay,
                 left(regexp_replace(query, '\\s+', ' ', 'g'), 55) AS q
            FROM pg_stat_activity
           WHERE usename = 'authenticator' AND datname = current_database()`);
        samples.push({ at: Date.now(), rows });
      } catch {
        /* bỏ qua mẫu lỗi */
      }
      await sleep(40);
    }
  })();

  const results = [];
  for (let i = 0; i < 5; i++) {
    const r = await restQuery("/rest/v1/notes?select=id&limit=1");
    results.push(r);
    await sleep(120);
  }
  sampling = false;
  await sampler;

  const activeSamples = samples.filter((s) => s.rows.some((r) => r.state === "active"));
  const maxDbSecs = Math.max(0, ...samples.flatMap((s) => s.rows.filter((r) => r.state === "active").map((r) => Number(r.giay))));

  console.log(`   Tổng số mẫu pg_stat_activity      : ${samples.length}`);
  console.log(`   Số mẫu thấy PostgREST ĐANG chạy   : ${activeSamples.length}  (${((activeSamples.length / samples.length) * 100).toFixed(1)}%)`);
  console.log(`   Thời gian chạy query dài nhất thấy: ${maxDbSecs.toFixed(3)}s`);

  const medTtfb = [...results.map((r) => r.ttfb)].sort((a, b) => a - b)[2];
  const medUp = [...results.map((r) => r.upstream)].sort((a, b) => a - b)[2];
  console.log(`\n   5 request PostgREST vừa bắn:`);
  for (const [i, r] of results.entries()) {
    console.log(`     #${i + 1}  TTFB=${r.ttfb.toFixed(0)}ms  Supabase tự báo xử lý=${r.upstream}ms`);
  }
  console.log(`   Trung vị: TTFB=${medTtfb.toFixed(0)}ms · Supabase xử lý=${medUp}ms`);

  if (activeSamples.length === 0) {
    console.log(
      `\n   ✅ KẾT LUẬN: trong ${(results.reduce((a, r) => a + r.ttfb, 0) / 1000).toFixed(1)}s bắn request, Postgres gần như KHÔNG chạy gì.`,
    );
    console.log(`      ⇒ Thời gian nằm ở PostgREST/gateway/pool hoặc đường mạng, KHÔNG phải Postgres xử lý query.`);
  } else {
    console.log(`\n   ⚠️  Postgres CÓ bận trong lúc đó — xem lại phần A và wait_event ở trên.`);
  }

  await db.end().catch(() => {});
  console.log("");
}

main().catch((e) => {
  console.error("lỗi:", e.message);
  process.exit(1);
});
