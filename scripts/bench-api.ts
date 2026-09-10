#!/usr/bin/env node
/**
 * BENCHMARK API — đo độ trễ từng endpoint (min/median/p95/max) để tìm chỗ chậm.
 *
 * Cách dùng:
 *   tsx scripts/bench-api.ts --base http://localhost:3100 --email admin@example.com --password admin123
 *   tsx scripts/bench-api.ts --n 30                 # số lần lặp mỗi endpoint
 *
 * Script tự:
 *   1. POST /api/v1/auth/login để lấy JWT
 *   2. Tạo 1 note (có 3 tag) qua POST /api/v1/notes
 *   3. Lặp N lần các endpoint đọc (GET) và in bảng thời gian
 */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = arg("base", "http://localhost:3100");
const EMAIL = arg("email", "admin@example.com");
const PASSWORD = arg("password", "admin123");
const N = Number(arg("n", 20));

const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return {
    min: s[0],
    median: at(50),
    p95: at(95),
    max: s[s.length - 1],
    avg: s.reduce((a, b) => a + b, 0) / s.length,
  };
};

async function timed(url, init) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  await res.arrayBuffer();
  const ms = performance.now() - t0;
  return { ms, status: res.status, text: "" };
}

async function timedJson(url, init) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = performance.now() - t0;
  return { ms, status: res.status, text };
}

const fmt = (n) => `${n.toFixed(1)}ms`.padStart(9);

const results = [];

async function bench(label, fn, n = N) {
  // warmup 2 lần (bỏ khỏi thống kê) để loại JIT/keep-alive
  for (let i = 0; i < 2; i++) await fn();
  const times = [];
  let lastStatus = 0;
  for (let i = 0; i < n; i++) {
    const r = await fn();
    times.push(r.ms);
    lastStatus = r.status;
  }
  const s = stats(times);
  results.push({ label, ...s, status: lastStatus });
  console.log(
    `${label.padEnd(44)} ${fmt(s.min)} ${fmt(s.median)} ${fmt(s.p95)} ${fmt(s.max)}  [${lastStatus}]`,
  );
}

async function main() {
  console.log(`\n▶ Benchmark ${BASE}  (n=${N} lần/endpoint, đã warmup)\n`);

  // 0) health (không auth, không DB)
  await bench("GET /health (no auth, no db)", () => timed(`${BASE}/health`));

  // 1) login (bcrypt compare)
  const login = await timedJson(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  console.log(`\nlogin status=${login.status} ${login.ms.toFixed(1)}ms body=${login.text.slice(0, 160)}\n`);
  let token = "";
  try {
    token = JSON.parse(login.text)?.data?.token ?? "";
  } catch {}
  if (!token) {
    console.log("⚠️  Không lấy được token — chỉ đo được endpoint public.");
    return;
  }
  const auth = { Authorization: `Bearer ${token}` };

  // 2) tạo note có tag để list có dữ liệu
  const created = await timedJson(`${BASE}/api/v1/notes`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ title: "Bench note", content: "# hello", tagNames: ["bench", "perf", "test"] }),
  });
  const noteId = (() => {
    try {
      return JSON.parse(created.text)?.data?.id;
    } catch {
      return undefined;
    }
  })();
  console.log(`create note status=${created.status} id=${noteId}\n`);

  console.log(`${"endpoint".padEnd(44)} ${"min".padStart(9)} ${"median".padStart(9)} ${"p95".padStart(9)} ${"max".padStart(9)}`);
  console.log("-".repeat(90));

  await bench("GET /api/v1/notes (auth)", () => timed(`${BASE}/api/v1/notes?limit=20`, { headers: auth }));
  await bench("GET /api/v1/notes?tag=bench", () => timed(`${BASE}/api/v1/notes?tag=bench`, { headers: auth }));
  await bench("GET /api/v1/tags", () => timed(`${BASE}/api/v1/tags`, { headers: auth }));
  await bench("GET /api/v1/users/me", () => timed(`${BASE}/api/v1/users/me`, { headers: auth }));
  if (noteId) {
    await bench("GET /api/v1/notes/:id", () => timed(`${BASE}/api/v1/notes/${noteId}`, { headers: auth }));
    await bench("GET /api/v1/notes/:id/raw", () => timed(`${BASE}/api/v1/notes/${noteId}/raw`, { headers: auth }));
  }

  // --- GHI (write) — mỗi tag là 1 vòng round-trip TUẦN TỰ trên driver Supabase ---
  console.log("\n-- nhóm GHI (write) --");
  const jsonPost = (path, payload, method = "POST") => () =>
    timedJson(`${BASE}${path}`, {
      method,
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  await bench("POST /api/v1/notes (không tag)", () => jsonPost("/api/v1/notes", { title: "w1", content: "x" })(), 5);
  await bench(
    "POST /api/v1/notes (3 tag)",
    () => jsonPost("/api/v1/notes", { title: "w3", content: "x", tagNames: ["a", "b", "c"] })(),
    5,
  );
  await bench(
    "POST /api/v1/notes (6 tag)",
    () => jsonPost("/api/v1/notes", { title: "w6", content: "x", tagNames: ["a", "b", "c", "d", "e", "f"] })(),
    5,
  );

  const worst = [...results].sort((a, b) => b.median - a.median)[0];
  console.log(`\n🐢 Endpoint chậm nhất (median): ${worst.label} = ${worst.median.toFixed(1)}ms\n`);
}

main().catch((e) => {
  console.error("bench lỗi:", e);
  process.exit(1);
});
