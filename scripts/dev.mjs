#!/usr/bin/env node
/**
 * LAUNCHER `npm run dev` — quyết định DB theo flag:
 *   - Mặc định (không có flag): chạy SUPABASE (PostgreSQL) — chạy thật.
 *   - `--local`: chạy SQLITE (node:sqlite, file dev.sqlite) — không cần DB server.
 *
 * Cách dùng:
 *   npm run dev                  # Supabase
 *   npm run dev -- --local       # SQLite   (npm cũng nhận `npm run dev --local`)
 *
 * Vì sao cần launcher mà không dùng `DB_DRIVER=x` trong script: cú pháp đó không
 * chạy trên Windows (chỉ bash). Launcher set process.env rồi spawn `tsx watch`,
 * còn dotenv KHÔNG ghi đè env đã có sẵn → server nhận đúng DB_DRIVER.
 */
import { spawn } from "node:child_process";

const local = process.argv.slice(2).includes("--local");
process.env.DB_DRIVER = local ? "sqlite" : "supabase";

console.log(
  `[dev] DB_DRIVER=${process.env.DB_DRIVER}${local ? " (SQLite local)" : " (Supabase)"}`,
);

const child = spawn("npx tsx watch src/server.ts", {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

const forward = (signal) => () => child.kill(signal);
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));

child.on("exit", (code) => process.exit(code ?? 0));
