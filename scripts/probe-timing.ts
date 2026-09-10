#!/usr/bin/env node
/**
 * BÓC TÁCH ĐỘ TRỄ THEO PHA — dùng https thô + keep-alive để biết thời gian đi đâu:
 *   DNS → TCP connect → TLS handshake → TTFB (chờ server) → body
 * Đồng thời đọc header `x-envoy-upstream-service-time` (thời gian xử lý THẬT bên Supabase).
 *
 *   tsx scripts/probe-timing.ts
 */
import { readFileSync } from "node:fs";
import https from "node:https";
import { performance } from "node:perf_hooks";

const t = readFileSync(new URL("../.env", import.meta.url), "utf8");
const of = (k) => t.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim();
const base = new URL(of("SUPABASE_URL"));
const key = of("SUPABASE_SERVICE_ROLE_KEY");

const agent = new https.Agent({ keepAlive: true, maxSockets: 10 });

function request(path, { freshSocket = false } = {}) {
  return new Promise((resolve, reject) => {
    const marks = {};
    const t0 = performance.now();
    const req = https.request(
      {
        host: base.host,
        path,
        method: "GET",
        agent: freshSocket ? new https.Agent({ keepAlive: false }) : agent,
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      },
      (res) => {
        marks.ttfb = performance.now() - t0;
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            ...marks,
            total: performance.now() - t0,
            status: res.statusCode,
            upstream: res.headers["x-envoy-upstream-service-time"],
            ray: res.headers["cf-ray"],
            bytes: chunks.reduce((a, c) => a + c.length, 0),
          });
        });
      },
    );
    req.on("socket", (socket) => {
      if (socket.__probed) return; // keep-alive: chỉ gắn listener 1 lần / socket
      socket.__probed = true;
      socket.on("lookup", () => (marks.dns = performance.now() - t0));
      socket.on("connect", () => (marks.tcp = performance.now() - t0));
      socket.on("secureConnect", () => (marks.tls = performance.now() - t0));
    });
    req.on("error", reject);
    req.end();
  });
}

const N = 12;

async function main() {
  console.log(`\n▶ Bóc tách độ trễ tới ${base.host} (keep-alive, ${N} lần)\n`);
  console.log(
    `${"path".padEnd(42)} ${"TTFB".padStart(9)} ${"total".padStart(9)} ${"upstream".padStart(9)} ${"ray".padStart(6)}`,
  );
  console.log("-".repeat(82));

  for (const path of ["/rest/v1/", "/rest/v1/notes?select=id&limit=1", "/rest/v1/tags?select=id&limit=1"]) {
    for (let i = 0; i < N; i++) {
      const r = await request(path);
      if (i === 0 || i === N - 1) {
        console.log(
          `${`${path}${i === 0 ? " (1st)" : " (last)"}`.padEnd(42)} ${`${r.ttfb.toFixed(0)}ms`.padStart(9)} ${`${r.total.toFixed(0)}ms`.padStart(9)} ${`${r.upstream ?? "-"}ms`.padStart(9)} ${String(r.ray ?? "").slice(-3).padStart(6)}`,
        );
      } else {
        process.stdout.write("");
      }
    }
    console.log("");
  }

  // Socket mới hoàn toàn (DNS + TCP + TLS) để so sánh
  const fresh = await request("/rest/v1/notes?select=id&limit=1", { freshSocket: true });
  console.log(
    `Socket MỚI (DNS+TCP+TLS): dns=${fresh.dns?.toFixed(0)}ms tcp=${fresh.tcp?.toFixed(0)}ms tls=${fresh.tls?.toFixed(0)}ms → ttfb=${fresh.ttfb.toFixed(0)}ms total=${fresh.total.toFixed(0)}ms`,
  );
  console.log(`\n💡 upstream = thời gian Supabase tự báo cho phần xử lý phía họ (PostgREST+Postgres).`);
}

main().catch((e) => {
  console.error("lỗi:", e);
  process.exit(1);
});
