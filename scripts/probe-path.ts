#!/usr/bin/env node
/**
 * LOCAL ĐANG CONNECT ĐI ĐÂU? — đo từng chặng của đường đi từ máy dev tới Supabase.
 *
 * Trả lời câu hỏi: "chạy local thì connect trực tiếp Supabase Singapore, sao lại chậm?"
 *
 *   1. DNS: 2 hostname khác nhau ở 2 nơi khác nhau
 *        - <ref>.supabase.co       → API/PostgREST (đi qua Cloudflare)
 *        - db.<ref>.supabase.co    → Postgres thật (đi thẳng tới AWS region)
 *   2. IP đó thuộc Cloudflare hay AWS? (đối chiếu danh sách IP chính thức của Cloudflare)
 *   3. RTT thực tế: TCP connect tới :443 (REST) vs :5432 (Postgres trực tiếp)
 *   4. TTFB ấm (keep-alive) của 3 loại request PostgREST:
 *        - /rest/v1/            (không rời edge)
 *        - bảng không tồn tại   (tới origin, KHÔNG chạy Postgres)
 *        - query thật           (tới origin + Postgres)
 */
import { readFileSync } from "node:fs";
import dns from "node:dns/promises";
import net from "node:net";
import https from "node:https";
import { performance } from "node:perf_hooks";

const t = readFileSync(new URL("../.env", import.meta.url), "utf8");
const of = (k) => t.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim();
const restHost = new URL(of("SUPABASE_URL")).host;
const ref = restHost.split(".")[0];
const dbHost = `db.${ref}.supabase.co`;
const key = of("SUPABASE_SERVICE_ROLE_KEY");

const hdr = (s) => `\n${"─".repeat(78)}\n${s}\n${"─".repeat(78)}`;

// ── 1. DNS ────────────────────────────────────────────────────────────────────
console.log(hdr("1. DNS — hai hostname, hai đích đến khác nhau"));
const resolve = async (h) => {
  try {
    const addrs = await dns.lookup(h, { all: true });
    return [...new Set(addrs.map((a) => a.address))];
  } catch (e) {
    return [`(lỗi: ${e.code})`];
  }
};
const restIps = await resolve(restHost);
const dbIps = await resolve(dbHost);
console.log(`   ${restHost.padEnd(42)} → ${restIps.join(", ")}`);
console.log(`   ${dbHost.padEnd(42)} → ${dbIps.join(", ")}`);

// ── 2. IP thuộc Cloudflare hay AWS? ───────────────────────────────────────────
console.log(hdr("2. Các IP trên thuộc nhà cung cấp nào?"));
let cfV4 = [];
try {
  const r = await fetch("https://api.cloudflare.com/client/v4/ips");
  const j = await r.json();
  cfV4 = j.result.ipv4_cidrs;
} catch {
  console.log("   (không lấy được danh sách IP Cloudflare)");
}
const inCidr = (ip, cidr) => {
  const [net4, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const toInt = (s) => s.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(net4) & mask);
};
for (const [label, ips] of [["PostgREST " + restHost, restIps], ["Postgres  " + dbHost, dbIps]]) {
  for (const ip of ips) {
    const isCf = ip.includes(".") && cfV4.some((c) => inCidr(ip, c));
    let who = isCf ? "☁️  CLOUDFLARE (anycast, không phải server Supabase)" : "🟠 không thuộc Cloudflare → có thể là AWS trực tiếp";
    if (!isCf && ip.includes(".")) {
      try {
        const r = await fetch(`https://ip-api.com/json/${ip}?fields=country,regionName,city,isp,org,as`);
        const j = await r.json();
        who += ` → ${j.city ?? "?"}, ${j.country ?? "?"} · ${j.isp ?? j.org ?? "?"}`;
      } catch {}
    }
    console.log(`   ${ip.padEnd(16)} ${label.padEnd(24)} ${who}`);
  }
}

// ── 3. RTT TCP thật tới từng đích ─────────────────────────────────────────────
console.log(hdr("3. RTT TCP thật (mở socket mới, đo 5 lần) — 1 vòng khứ hồi"));
const tcpRtt = (host, port) =>
  new Promise((res) => {
    const t0 = performance.now();
    const s = net.connect({ host, port });
    s.setTimeout(8000);
    s.on("connect", () => {
      res(performance.now() - t0);
      s.destroy();
    });
    s.on("timeout", () => {
      res(NaN);
      s.destroy();
    });
    s.on("error", () => {
      res(NaN);
      s.destroy();
    });
  });
const rtt = async (label, host, port) => {
  const xs = [];
  for (let i = 0; i < 5; i++) xs.push(await tcpRtt(host, port));
  const ok = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  console.log(
    `   ${label.padEnd(46)} min=${ok[0]?.toFixed(0)}ms median=${ok[Math.floor(ok.length / 2)]?.toFixed(0)}ms`,
  );
};
await rtt(`${restHost}:443   (REST qua Cloudflare)`, restHost, 443);
await rtt(`${dbHost}:5432  (Postgres TRỰC TIẾP)`, dbHost, 5432);

// ── 4. TTFB ấm qua PostgREST ──────────────────────────────────────────────────
console.log(hdr("4. TTFB qua PostgREST (keep-alive ấm, 8 lần) + thời gian Supabase tự báo"));
const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });
const probe = (path) =>
  new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.request(
      { host: restHost, path, method: "GET", agent, headers: { apikey: key, Authorization: `Bearer ${key}` } },
      (res) => {
        const ttfb = performance.now() - t0;
        res.resume();
        res.on("end", () => resolve({ ttfb, upstream: res.headers["x-envoy-upstream-service-time"], status: res.statusCode }));
      },
    );
    req.on("error", reject);
    req.end();
  });
const run = async (label, path) => {
  const out = [];
  for (let i = 0; i < 8; i++) out.push(await probe(path));
  const s = out.map((o) => o.ttfb).sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const up = out.map((o) => o.upstream).filter(Boolean);
  console.log(
    `   ${label.padEnd(44)} TTFB median=${med.toFixed(0)}ms  · Supabase xử lý=${up.length ? Math.max(...up.map(Number)) + "ms" : "?"}  [${out.at(-1).status}]`,
  );
};
await run("/rest/v1/  (KHÔNG rời Cloudflare edge)", "/rest/v1/");
await run("bảng không tồn tại (tới origin, KHÔNG đụng Postgres)", "/rest/v1/khong_co_bang_nay?select=id");
await run("query thật notes?select=id&limit=1", "/rest/v1/notes?select=id&limit=1");

console.log(
  `\n💡 Nếu "bảng không tồn tại" và "query thật" tốn gần bằng nhau ⇒ phần chênh không phải do Postgres,\nmà do chặng mạng Cloudflare-edge → origin.\n`,
);
