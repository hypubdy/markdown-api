#!/usr/bin/env node
/**
 * KIỂM TRA NGHẼN DO SONG SONG — độ trễ 1 query thay đổi thế nào khi bắn K query cùng lúc?
 *
 * Nếu độ trễ mỗi query TĂNG VỌT theo K ⇒ connection pool của Supabase bị bão hoà:
 * càng fan-out nhiều (N+1) thì mỗi query càng chậm, không phải chỉ "nhiều query nên lâu".
 *
 *   tsx scripts/probe-concurrency.ts [danh_sách_K]
 *   tsx scripts/probe-concurrency.ts 1,4,8,16,32
 */
import { readFileSync } from "node:fs";
import https from "node:https";
import { performance } from "node:perf_hooks";

const t = readFileSync(new URL("../.env", import.meta.url), "utf8");
const of = (k) => t.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim();
const host = new URL(of("SUPABASE_URL")).host;
const key = of("SUPABASE_SERVICE_ROLE_KEY");

const agent = new https.Agent({ keepAlive: true, maxSockets: 128 });

const query = (path = "/rest/v1/notes?select=id&limit=1") =>
  new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.request(
      { host, path, method: "GET", agent, headers: { apikey: key, Authorization: `Bearer ${key}` } },
      (res) => {
        const ttfb = performance.now() - t0;
        res.resume();
        res.on("end", () =>
          resolve({
            ms: ttfb,
            upstream: Number(res.headers["x-envoy-upstream-service-time"] ?? 0),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];

async function main() {
  const levels = (process.argv[2] ?? "1,4,8,16,32").split(",").map(Number);

  console.log(`\n▶ Bắn K query "SELECT id FROM notes LIMIT 1" CÙNG LÚC @ ${host}\n`);
  console.log(
    `${"K".padStart(3)} ${"tường".padStart(10)} ${"1 query (TV)".padStart(14)} ${"1 query (p95)".padStart(15)} ${"Supabase xử lý (TV)".padStart(21)} ${"query/giây".padStart(11)}`,
  );
  console.log("-".repeat(82));

  for (const k of levels) {
    await query(); // làm ấm keep-alive

    const startedAt = performance.now();
    const results = await Promise.all(Array.from({ length: k }, () => query()));
    const wall = performance.now() - startedAt;

    const ms = results.map((r) => r.ms);
    const ups = results.map((r) => r.upstream);

    console.log(
      `${String(k).padStart(3)} ${`${wall.toFixed(0)}ms`.padStart(10)} ${`${med(ms).toFixed(0)}ms`.padStart(14)} ${`${pct(ms, 95).toFixed(0)}ms`.padStart(15)} ${`${med(ups).toFixed(0)}ms`.padStart(21)} ${(k / (wall / 1000)).toFixed(1).padStart(11)}`,
    );
  }

  console.log(
    `\n💡 Đọc bảng: nếu cột "1 query (TV)" tăng mạnh theo K ⇒ pool bị bão hoà (query phải xếp hàng).`,
  );
  console.log(`   Khi đó fan-out N+1 vừa tạo nhiều query, vừa làm MỖI query chậm đi — nhân 2 lần thiệt.\n`);
}

main().catch((e) => {
  console.error("lỗi:", e.message);
  process.exit(1);
});
