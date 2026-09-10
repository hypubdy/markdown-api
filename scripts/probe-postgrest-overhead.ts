#!/usr/bin/env node
/**
 * KHOANH VÙNG ĐỘ TRỄ POSTGREST — trả lời: 200–400ms nằm ở đâu?
 *
 *   A. /rest/v1/                     → qua Kong, KHÔNG đụng Postgres
 *   B. bảng KHÔNG tồn tại (404)      → PostgREST xử lý, vẫn KHÔNG đụng Postgres
 *   C. SELECT 1 dòng bảng thật       → PostgREST + Postgres
 *   D. 10 request C cùng lúc         → kiểm tra nghẽn connection pool
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
const envOf = (k) => envText.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim();
const BASE = envOf("SUPABASE_URL");
const KEY = envOf("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const stat = (label, times) => {
  const s = [...times].sort((a, b) => a - b);
  console.log(
    `${label.padEnd(48)} min=${s[0].toFixed(0)}ms  median=${s[Math.floor(s.length / 2)].toFixed(0)}ms  max=${s[s.length - 1].toFixed(0)}ms`,
  );
};

async function loop(label, url, n = 10) {
  const times = [];
  let status = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const res = await fetch(url, { headers });
    await res.text();
    times.push(performance.now() - t0);
    status = res.status;
  }
  stat(`${label} [${status}]`, times);
}

async function main() {
  console.log(`\n▶ Khoanh vùng độ trễ PostgREST @ ${new URL(BASE).host}\n`);

  await loop("A. /rest/v1/  (không đụng Postgres)", `${BASE}/rest/v1/`);
  await loop("B. bảng không tồn tại → 404 (không đụng Postgres)", `${BASE}/rest/v1/khong_ton_tai?select=id`);
  await loop("C. GET notes?select=id&limit=1  (Postgres thật)", `${BASE}/rest/v1/notes?select=id&limit=1`);
  await loop("C2. GET tags?select=id&limit=1 (Postgres thật)", `${BASE}/rest/v1/tags?select=id&limit=1`);

  // D. 10 request song song
  const t0 = performance.now();
  const parallel = await Promise.all(
    Array.from({ length: 10 }, () =>
      fetch(`${BASE}/rest/v1/notes?select=id&limit=1`, { headers }).then((r) => r.text()),
    ),
  );
  const wall = performance.now() - t0;
  console.log(
    `\nD. 10 request C song song: tổng ${wall.toFixed(0)}ms (≈${(wall / 10).toFixed(0)}ms/request) — nếu ≈ độ trễ 1 request thì KHÔNG nghẽn pool, nếu ≈10x thì pool bị serialize.`,
  );
  console.log(`   (số response nhận được: ${parallel.length})`);
}

main().catch((e) => {
  console.error("probe lỗi:", e);
  process.exit(1);
});
