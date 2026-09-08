import type { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { env } from "../config/env";
import { PgUserRepository } from "./user.pg.repository";
import type { UserRepository } from "./user.repository";

/**
 * FACTORY TẦNG DỮ LIỆU — chọn driver theo env.DB_DRIVER:
 *   - "postgres" → pg Pool nối DATABASE_URL (chạy thật)
 *   - "sqlite"   → node:sqlite ":memory:"/file (test & dev nhanh)
 *
 * LƯU Ý:
 * - Mọi thứ đều LAZY: driver (kể cả module node:sqlite) chỉ được nạp khi thực sự
 *   cần — nhờ vậy test set env TRƯỚC khi gọi, và chạy PostgreSQL không bị cảnh báo
 *   "SQLite experimental" từ việc import nhầm driver.
 */

export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_PASSWORD = "admin123";

let repository: UserRepository | undefined;
let initPromise: Promise<void> | undefined;
let pgPool: Pool | undefined;
let sqliteDb: DatabaseSync | undefined;

/** Tạo (1 lần) repository theo driver đã chọn và trả về */
export async function getUserRepository(): Promise<UserRepository> {
  if (!repository) {
    if (env.DB_DRIVER === "postgres") {
      pgPool = new Pool({ connectionString: env.DATABASE_URL });
      repository = new PgUserRepository(pgPool);
    } else {
      const { DatabaseSync } = await import("node:sqlite");
      const { SqliteUserRepository } = await import(
        "./user.sqlite.repository"
      );
      sqliteDb = new DatabaseSync(env.DB_FILE);
      repository = new SqliteUserRepository(sqliteDb);
    }
  }
  return repository;
}

/** Tạo bảng nếu chưa có (chạy đúng 1 lần) */
export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = getUserRepository().then((repo) => repo.init());
  }
  return initPromise;
}

/** Xoá toàn bộ user (dùng cho test khi DB là file — để mỗi suite bắt đầu sạch) */
export async function clearAllUsers(): Promise<void> {
  const repo = await getUserRepository();
  const users = await repo.findAll();
  for (const user of users) {
    await repo.deleteById(user.id);
  }
}

/**
 * Seed tài khoản admin mẫu.
 * @param options.reset = true → xoá hết user trước (CHỈ nên dùng cho DB test;
 *        server chạy thật gọi seedDemoAdmin() không reset để không mất dữ liệu)
 */
export async function seedDemoAdmin(options: { reset?: boolean } = {}): Promise<void> {
  await initDatabase();
  const repo = await getUserRepository();

  if (options.reset) {
    await clearAllUsers();
  }

  const existing = await repo.findByEmail(ADMIN_EMAIL);
  if (!existing) {
    await repo.create({
      name: "Quản trị viên",
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: "admin",
    });
    console.log(`👤 Đã tạo tài khoản demo: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }
}

/** Đóng kết nối DB (gọi khi tắt server — graceful shutdown) */
export async function closeDatabase(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = undefined;
  }
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = undefined;
  }
  repository = undefined;
  initPromise = undefined;
}
