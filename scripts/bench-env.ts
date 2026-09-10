/**
 * Đo chi phí truy cập `env` — proxy trong src/config/env.ts gọi readEnv() (zod safeParse
 * toàn bộ process.env) MỖI LẦN đọc 1 thuộc tính.
 *
 * Chạy:  tsx scripts/bench-env.ts
 */
import { env } from "../src/config/env";

const N = 200_000;

// 1) Chi phí 1 lần đọc env.X
let t0 = performance.now();
for (let i = 0; i < N; i++) void env.JWT_SECRET;
const perAccess = (performance.now() - t0) / N;

// 2) Chi phí "1 request điển hình" đọc bao nhiêu lần env?
//    Đếm thô: middleware + action đọc env khoảng vài lần.
t0 = performance.now();
for (let i = 0; i < N; i++) {
  void env.DB_DRIVER;
  void env.AUTH_PROVIDER;
  void env.JWT_SECRET;
}
const perRequest = (performance.now() - t0) / N;

console.log(`\n▶ Chi phí proxy env (zod safeParse lại toàn bộ process.env mỗi lần đọc)`);
console.log(`   1 lần đọc env.X      : ${(perAccess * 1000).toFixed(2)} µs`);
console.log(`   1 request (3 lần đọc): ${(perRequest * 1000).toFixed(2)} µs  ≈ ${perRequest.toFixed(3)} ms`);
console.log(`   Số lần đọc env trong source: xem \`grep -c "env\\." src\``);
