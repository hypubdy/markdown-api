#!/usr/bin/env node
/**
 * BENCH KHÔNG CẦN TOKEN — dùng để đo chế độ Clerk (không login được bằng mật khẩu)
 * và để thấy chi phí middleware khi request KHÔNG đụng DB.
 *
 *   tsx scripts/bench-unauth.ts --base http://localhost:3102 --n 15
 */
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3102");
const N = Number(arg("n", 15));

const stat = (times) => {
  const s = [...times].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { min: s[0], median: at(50), p95: at(95), max: s[s.length - 1] };
};
const fmt = (n) => `${n.toFixed(1)}ms`.padStart(9);

async function bench(label, url, init) {
  for (let i = 0; i < 2; i++) await fetch(url, init).then((r) => r.text());
  const times = [];
  let status = 0;
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const res = await fetch(url, init);
    await res.text();
    times.push(performance.now() - t0);
    status = res.status;
  }
  const s = stat(times);
  console.log(`${label.padEnd(46)} ${fmt(s.min)} ${fmt(s.median)} ${fmt(s.p95)} ${fmt(s.max)}  [${status}]`);
}

console.log(`\n▶ Bench KHÔNG token: ${BASE} (n=${N})\n`);
console.log(`${"endpoint".padEnd(46)} ${"min".padStart(9)} ${"median".padStart(9)} ${"p95".padStart(9)} ${"max".padStart(9)}`);
console.log("-".repeat(92));
await bench("GET /api/v1/health (no auth, no db)", `${BASE}/api/v1/health`);
await bench("GET /api/v1/notes (no token → 401)", `${BASE}/api/v1/notes`);
await bench("GET /api/v1/tags (no token → 401)", `${BASE}/api/v1/tags`);
await bench("GET /api/v1/users/me (no token → 401)", `${BASE}/api/v1/users/me`);
await bench("GET /api/v1/public/notes/xxx (no auth)", `${BASE}/api/v1/public/notes/xxx`);
await bench("POST /api/v1/auth/login (clerk → 410)", `${BASE}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "a@b.com", password: "123456" }),
});
console.log("");
