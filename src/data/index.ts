import type { DatabaseSync } from "node:sqlite";
import type { PostgrestClient } from "@supabase/postgrest-js";
import { createSupabaseClient } from "./supabase.client";
import { bootstrapSupabaseSchema } from "./supabase.bootstrap";
import { env } from "../config/env";
import { SupabaseUserRepository } from "./user.supabase.repository";
import type { NoteRepository } from "./note.repository";
import type { UserRepository } from "./user.repository";

/**
 * FACTORY TẦNG DỮ LIỆU — chọn driver theo env.DB_DRIVER:
 *   - "supabase" → PostgREST client nối SUPABASE_URL (chạy thật, chạy được trên
 *                  Cloudflare Worker vì chỉ dùng fetch — không cần TCP socket)
 *   - "sqlite"   → node:sqlite ":memory:"/file (test & dev nhanh)
 *
 * LƯU Ý:
 * - Mọi thứ đều LAZY: driver (kể cả module node:sqlite) chỉ được nạp khi thực sự
 *   cần — nhờ vậy test set env TRƯỚC khi gọi, và chạy Supabase không bị cảnh báo
 *   "SQLite experimental" từ việc import nhầm driver.
 * - User repo và Note repo DÙNG CHUNG 1 connection/1 client (sb / sqliteDb) để FK
 *   notes.owner_id → users.id được kiểm soát đúng trên cùng connection.
 */

export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_PASSWORD = "admin123";

let repository: UserRepository | undefined;
let noteRepository: NoteRepository | undefined;
let initPromise: Promise<void> | undefined;
let sb: PostgrestClient | undefined;
let sqliteDb: DatabaseSync | undefined;

/** Tạo (1 lần) repository theo driver đã chọn và trả về */
export async function getUserRepository(): Promise<UserRepository> {
  if (!repository) {
    if (env.DB_DRIVER === "supabase") {
      sb = createSupabaseClient();
      repository = new SupabaseUserRepository(sb);
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

/** Tạo (1 lần) note repository — DÙNG CHUNG client/DatabaseSync với user repository */
export async function getNoteRepository(): Promise<NoteRepository> {
  if (!noteRepository) {
    await getUserRepository(); // đảm bảo sb/sqliteDb đã được mở
    if (env.DB_DRIVER === "supabase") {
      const { SupabaseNoteRepository } = await import(
        "./note.supabase.repository"
      );
      noteRepository = new SupabaseNoteRepository(sb!);
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
      // Supabase: tự tạo bảng qua connection string (pg) nếu đặt DATABASE_URL.
      // Nếu không đặt, yêu cầu bảng đã được tạo bằng supabase/schema.sql.
      if (env.DB_DRIVER === "supabase" && env.DATABASE_URL) {
        await bootstrapSupabaseSchema(env.DATABASE_URL);
      }
      const userRepo = await getUserRepository();
      await userRepo.init(); // 1) users (Supabase: kiểm tra bảng, không tạo)
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
  if (env.DB_DRIVER === "supabase") {
    // Delete theo FK: note_tags tự cascade, xoá notes rồi tags.
    await sb!.from("note_tags").delete();
    await sb!.from("notes").delete();
    await sb!.from("tags").delete();
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
  // Supabase: client HTTP stateless — không cần đóng, chỉ reset reference.
  sb = undefined;
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = undefined;
  }
  repository = undefined;
  noteRepository = undefined;
  initPromise = undefined;
}
