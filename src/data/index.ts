import type { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { env } from "../config/env";
import { PgUserRepository } from "./user.pg.repository";
import type { NoteRepository } from "./note.repository";
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
 * - User repo và Note repo DÙNG CHUNG 1 connection (pgPool / sqliteDb) để FK
 *   notes.owner_id → users.id được kiểm soát đúng trên cùng connection.
 */

export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_PASSWORD = "admin123";

let repository: UserRepository | undefined;
let noteRepository: NoteRepository | undefined;
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

/** Tạo (1 lần) note repository — DÙNG CHUNG pool/DatabaseSync với user repository */
export async function getNoteRepository(): Promise<NoteRepository> {
  if (!noteRepository) {
    await getUserRepository(); // đảm bảo pgPool/sqliteDb đã được mở
    if (env.DB_DRIVER === "postgres") {
      const { PgNoteRepository } = await import("./note.pg.repository");
      noteRepository = new PgNoteRepository(pgPool!);
    } else {
      const { SqliteNoteRepository } = await import(
        "./note.sqlite.repository"
      );
      noteRepository = new SqliteNoteRepository(sqliteDb!);
    }
  }
  return noteRepository;
}

/** Tạo bảng nếu chưa có (chạy đúng 1 lần) — users TRƯỚC, rồi notes/tags/note_tags theo thứ tự FK */
export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const userRepo = await getUserRepository();
      await userRepo.init(); // 1) users
      const notes = await getNoteRepository();
      await notes.init(); // 2) notes, tags, note_tags, index
    })();
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

/** Xoá toàn bộ notes + tags (test file-mode); note_tags tự sạch qua ON DELETE CASCADE */
export async function clearAllNotes(): Promise<void> {
  await initDatabase();
  if (env.DB_DRIVER === "postgres") {
    await pgPool!.query("DELETE FROM note_tags");
    await pgPool!.query("DELETE FROM notes");
    await pgPool!.query("DELETE FROM tags");
  } else {
    sqliteDb!.exec("DELETE FROM note_tags");
    sqliteDb!.exec("DELETE FROM notes");
    sqliteDb!.exec("DELETE FROM tags");
  }
}

/**
 * Seed tài khoản admin mẫu.
 * @param options.reset = true → xoá hết notes + users trước (CHỈ nên dùng cho DB test;
 *        server chạy thật gọi seedDemoAdmin() không reset để không mất dữ liệu)
 */
export async function seedDemoAdmin(options: { reset?: boolean } = {}): Promise<void> {
  await initDatabase();
  const repo = await getUserRepository();

  if (options.reset) {
    // Xoá notes/tags TRƯỚC rồi mới xoá users — tránh vi phạm FK
    // notes.owner_id → users.id (không cascade) khi DB là file.
    await clearAllNotes();
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
  noteRepository = undefined;
  initPromise = undefined;
}
