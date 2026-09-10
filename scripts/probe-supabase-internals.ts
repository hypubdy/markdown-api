#!/usr/bin/env node
/**
 * KHÁM NỘI TẠI SUPABASE — nối THẲNG vào Postgres (pg) để đọc catalog, xem:
 *   - cỡ instance / tham số cấu hình (max_connections, shared_buffers, work_mem…)
 *   - connection pool hiện tại: bao nhiêu connection, đang active/idle/waiting
 *   - query nào đang chạy lâu
 *   - tỉ lệ cache hit, temp file, deadlock → có bị nghẽn I/O không
 *
 * Tất cả đều là câu lệnh ĐỌC catalog (an toàn, không sửa dữ liệu).
 *
 *   tsx scripts/probe-supabase-internals.ts
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const t = readFileSync(new URL("../.env", import.meta.url), "utf8");
const all = (k) => [...t.matchAll(new RegExp(`^${k}=(.*)$`, "gm"))].map((m) => m[1].trim());
const host = new URL(all("SUPABASE_URL")[0]).host;
const ref = host.split(".")[0];
const urls = all("DATABASE_URL");
const poolerUrl = urls.find((u) => u.includes("pooler"));
const directUrl = `postgresql://postgres:VaWntuhy%402719@db.${ref}.supabase.co:5432/postgres`;

const hidePw = (u) => u.replace(/:[^:@]*@/, ":****@");
const line = (s) => console.log(`\n${"─".repeat(78)}\n${s}\n${"─".repeat(78)}`);

async function connect(url) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  await client.connect();
  return client;
}

async function q(client, sql, label) {
  try {
    const { rows } = await client.query(sql);
    console.log(`\n▸ ${label}`);
    if (rows.length === 0) {
      console.log("   (không có dòng nào)");
      return rows;
    }
    const cols = Object.keys(rows[0]);
    const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
    console.log("   " + cols.map((c, i) => c.padEnd(widths[i])).join(" | "));
    console.log("   " + widths.map((w) => "-".repeat(w)).join("-+-"));
    for (const row of rows.slice(0, 15)) {
      console.log("   " + cols.map((c, i) => String(row[c] ?? "").padEnd(widths[i])).join(" | "));
    }
    if (rows.length > 15) console.log(`   … còn ${rows.length - 15} dòng`);
    return rows;
  } catch (e) {
    console.log(`\n▸ ${label}\n   ❌ ${e.message}`);
    return [];
  }
}

async function main() {
  console.log(`\n▶ Khám nội tại Supabase: ${ref}`);
  console.log(`   direct: ${hidePw(directUrl)}`);
  if (poolerUrl) console.log(`   pooler: ${hidePw(poolerUrl)}`);
  console.log(`   (thời điểm đo: ${new Date().toISOString()})`);

  const direct = await connect(directUrl);

  line("1. PHIÊN BẢN & CẤU HÌNH INSTANCE");
  await q(direct, `SELECT version() AS version`, "version()");
  await q(
    direct,
    `SELECT name, setting, unit
       FROM pg_settings
      WHERE name IN ('max_connections','superuser_reserved_connections','shared_buffers',
                     'work_mem','maintenance_work_mem','effective_cache_size',
                     'max_worker_processes','max_parallel_workers','statement_timeout',
                     'idle_in_transaction_session_timeout','max_locks_per_transaction')
      ORDER BY name`,
    "tham số cấu hình quan trọng",
  );
  await q(direct, `SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size`, "dung lượng DB");
  await q(direct, `SELECT pg_size_pretty(sum(pg_relation_size(oid))) AS tables_size FROM pg_class WHERE relkind IN ('r','m')`, "dung lượng bảng");

  line("2. CONNECTION POOL — ai đang giữ bao nhiêu connection");
  await q(
    direct,
    `SELECT usename, coalesce(application_name,'(trống)') AS app, state, count(*) AS conns
       FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY 1,2,3
      ORDER BY 4 DESC`,
    "connection theo user / application / state",
  );
  await q(
    direct,
    `SELECT count(*) AS tong,
            count(*) FILTER (WHERE state = 'active')  AS active,
            count(*) FILTER (WHERE state = 'idle')    AS idle,
            count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
            count(*) FILTER (WHERE wait_event_type IS NOT NULL AND state = 'active') AS dang_cho
       FROM pg_stat_activity
      WHERE datname = current_database()`,
    "tổng quan connection",
  );
  await q(
    direct,
    `SELECT wait_event_type, wait_event, count(*) AS n
       FROM pg_stat_activity
      WHERE datname = current_database() AND state = 'active'
      GROUP BY 1,2 ORDER BY 3 DESC`,
    "đang chờ cái gì (nếu active mà wait_event_type khác NULL = đang bị chặn)",
  );

  line("3. QUERY ĐANG CHẠY LÂU");
  await q(
    direct,
    `SELECT pid, usename, coalesce(application_name,'(trống)') AS app, state,
            wait_event_type, wait_event,
            round(extract(epoch FROM (now() - query_start))::numeric, 1) AS giay,
            left(regexp_replace(query, '\\s+', ' ', 'g'), 90) AS query
       FROM pg_stat_activity
      WHERE datname = current_database() AND state <> 'idle' AND query_start IS NOT NULL
      ORDER BY query_start ASC
      LIMIT 10`,
    "10 query chạy lâu nhất hiện tại",
  );

  line("4. SỨC KHOẺ I/O & CACHE");
  await q(
    direct,
    `SELECT datname,
            xact_commit, xact_rollback, deadlocks, conflicts,
            blks_hit, blks_read,
            round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) AS cache_hit_pct,
            pg_size_pretty(temp_bytes) AS temp_spill
       FROM pg_stat_database
      WHERE datname = current_database()`,
    "thống kê DB (cache_hit_pct thấp = phải đọc đĩa nhiều; temp_spill lớn = sort/hash tràn RAM)",
  );
  await q(
    direct,
    `SELECT relname, seq_scan, idx_scan, n_live_tup, n_dead_tup,
            round(100.0 * seq_scan / nullif(seq_scan + idx_scan, 0), 1) AS seq_pct,
            last_autovacuum, last_autoanalyze
       FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC`,
    "truy cập bảng (seq_pct cao trên bảng lớn = thiếu index)",
  );
  await q(direct, `SELECT count(*) AS co_pg_stat_statements FROM pg_extension WHERE extname = 'pg_stat_statements'`, "có extension pg_stat_statements?");

  line("5. SO SÁNH NHANH: Postgres trực tiếp vs PostgREST (cùng lúc)");
  const t0 = performance.now();
  await direct.query("SELECT id FROM notes LIMIT 1");
  const directMs = performance.now() - t0;

  const restMs = await (async () => {
    const key = all("SUPABASE_SERVICE_ROLE_KEY")[0];
    const t = performance.now();
    const res = await fetch(`${all("SUPABASE_URL")[0]}/rest/v1/notes?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    await res.text();
    console.log(`   PostgREST tự báo xử lý: ${res.headers.get("x-envoy-upstream-service-time") ?? "?"}ms`);
    return performance.now() - t;
  })();

  console.log(`   Postgres trực tiếp : ${directMs.toFixed(0)}ms`);
  console.log(`   PostgREST (HTTPS)  : ${restMs.toFixed(0)}ms`);
  console.log(`   → tỉ lệ: ${(restMs / directMs).toFixed(1)}×`);

  await direct.end().catch(() => {});
  console.log("");
}

main().catch((e) => {
  console.error("lỗi:", e.message);
  process.exit(1);
});
