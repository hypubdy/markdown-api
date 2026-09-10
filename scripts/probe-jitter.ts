#!/usr/bin/env node
/**
 * TÁCH "MẠNG" KHỎI "SUPABASE XỬ LÝ" — lấy mẫu 20 lần một query thật, in từng mẫu.
 *
 * Mỗi response Supabase đều kèm header `x-envoy-upstream-service-time` = thời gian
 * CHÍNH Supabase báo cho phần xử lý phía họ (gateway → PostgREST → Postgres).
 *
 *   TTFB (client thấy) = [mạng: máy dev ↔ Cloudflare edge ↔ origin]  +  upstream (Supabase xử lý)
 *
 * Nếu upstream nhỏ mà TTFB lớn  → chậm ở ĐƯỜNG MẠNG.
 * Nếu upstream lớn             → chậm ở PHÍA SUPABASE.
 *
 *   tsx scripts/probe-jitter.ts [số_lần]
 */
import { readFileSync } from "node:fs";
import https from "node:https";
import { performance } from "node:perf_hooks";

const t = readFileSync(new URL("../.env", import.meta.url), "utf8");
const of = (k) => t.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim();
const host = new URL(of("SUPABASE_URL")).host;
const key = of("SUPABASE_SERVICE_ROLE_KEY");
const N = Number(process.argv[2] ?? 20);

const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

const probe = (path) =>
  new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.request(
      { host, path, method: "GET", agent, headers: { apikey: key, Authorization: `Bearer ${key}` } },
      (res) => {
        const ttfb = performance.now() - t0;
        res.resume();
        res.on("end", () =>
          resolve({ ttfb, upstream: Number(res.headers["x-envoy-upstream-service-time"] ?? NaN), status: res.statusCode, colo: String(res.headers["cf-ray"] ?? "").slice(-3) }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function main() {
  console.log(`\n▶ Lấy mẫu ${N} lần: GET /rest/v1/notes?select=id&limit=1 @ ${host}\n`);
  console.log(
    `${"#".padStart(3)} ${"TTFB".padStart(9)} ${"Supabase xử lý".padStart(15)} ${"Phần mạng".padStart(11)}  ${"colo".padStart(5)}`,
  );
  console.log("-".repeat(52));

  const ttfbs = [];
  const upstreams = [];
  for (let i = 1; i <= N; i++) {
    const r = await probe("/rest/v1/notes?select=id&limit=1");
    const net = r.ttfb - (Number.isNaN(r.upstream) ? 0 : r.upstream);
    ttfbs.push(r.ttfb);
    if (!Number.isNaN(r.upstream)) upstreams.push(r.upstream);
    console.log(
      `${String(i).padStart(3)} ${`${r.ttfb.toFixed(0)}ms`.padStart(9)} ${`${Number.isNaN(r.upstream) ? "?" : r.upstream}ms`.padStart(15)} ${`${net.toFixed(0)}ms`.padStart(11)}  ${r.colo.padStart(5)}`,
    );
  }

  console.log("-".repeat(52));
  console.log(`Trung vị TTFB          : ${med(ttfbs).toFixed(0)}ms`);
  console.log(`Trung vị Supabase xử lý: ${med(upstreams).toFixed(0)}ms`);
  console.log(`Trung vị phần mạng     : ${(med(ttfbs) - med(upstreams)).toFixed(0)}ms`);
  console.log(`Max TTFB               : ${Math.max(...ttfbs).toFixed(0)}ms\n`);
}

main().catch((e) => {
  console.error("lỗi:", e);
  process.exit(1);
});
