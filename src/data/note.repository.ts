import type {
  CreateNoteInput,
  Note,
  NoteListFilters,
  NoteListResult,
  NoteStatus,
  TagCount,
  UpdateNoteInput,
} from "../types/index";

/**
 * GIAO DIỆN CHUNG cho tầng truy xuất notes/tags.
 * Các action chỉ phụ thuộc interface này — không biết SQLite hay PostgreSQL
 * (giống UserRepository ở user.repository.ts).
 *
 * Bất biến quan trọng:
 * - Mọi truy vấn theo note đều ghép `owner_id` → note của người khác trả
 *   `null`/`false`/không xuất hiện như thể KHÔNG tồn tại.
 * - "Note SỐNG" = `deleted_at IS NULL`.
 */

/** Một dòng thô của bảng notes do DB trả về (cột snake_case) */
export interface NoteRow {
  id: string;
  owner_id: string;
  title: string;
  content: string;
  status: string; // "draft" | "published"
  deleted_at: string | Date | null; // NULL = còn sống
  share_token: string | null; // NULL = chưa public
  created_at: string | Date;
  updated_at: string | Date;
}

/** Một dòng thô trả về khi đếm tag theo note (JOIN tags) */
export interface TagNameRow {
  name: string;
}

/** Cột SELECT dùng chung cho cả 2 driver (không dùng SELECT *) */
export const NOTE_SELECT_COLUMNS =
  "id, owner_id, title, content, status, deleted_at, share_token, created_at, updated_at";

/** Giao diện repository notes/tags (chữ ký đầy đủ — hợp đồng bắt buộc) */
export interface NoteRepository {
  /** Tạo bảng notes/tags/note_tags nếu chưa có + chuẩn bị câu lệnh (chạy 1 lần). */
  init(): Promise<void>;

  // ── Notes ────────────────────────────────────────────────────────────
  /** Tạo note mới (tự sinh id; content? → '', status? → 'draft'); trả Note đã lưu. */
  create(input: CreateNoteInput): Promise<Note>;

  /** Note SỐNG theo (ownerId, id); sai owner / không tồn tại / đã soft-delete → null. */
  findById(ownerId: string, id: string): Promise<Note | null>;

  /**
   * Danh sách note SỐNG của owner, lọc tuỳ chọn q/status/tag, phân trang.
   * - q: title HOẶC content chứa chuỗi (LIKE '%q%', không phân biệt hoa thường)
   * - status: lọc đúng trạng thái
   * - tag: chỉ note đang mang tag tên = `tag` (của chính owner)
   * - page ≥ 1 (mặc định 1), limit 1..100 (mặc định 10)
   * - items sắp theo updated_at DESC; total = tổng note SỐNG thoả bộ lọc (không đổi theo page)
   */
  list(filters: NoteListFilters): Promise<NoteListResult>;

  /** Danh sách note ĐÃ soft-delete của owner (deleted_at IS NOT NULL). */
  listTrash(ownerId: string): Promise<Note[]>;

  /** Sửa một phần {title?, content?, status?} của note SỐNG; bump updated_at; null nếu không hợp lệ. */
  update(
    ownerId: string,
    id: string,
    changes: UpdateNoteInput,
  ): Promise<Note | null>;

  /** Đánh dấu xoá mềm (set deleted_at = now); true chỉ khi note SỐNG thuộc owner vừa bị xoá. */
  softDelete(ownerId: string, id: string): Promise<boolean>;

  /** Khôi phục từ thùng rác (xoá deleted_at); trả Note hoặc null nếu không phải note đã xoá của owner. */
  restore(ownerId: string, id: string): Promise<Note | null>;

  /** Xoá HẲN dòng (không quan tâm deleted_at); true khi có dòng thuộc owner bị xoá. */
  hardDelete(ownerId: string, id: string): Promise<boolean>;

  /**
   * Đặt token public share (token = null → THU HỒI share). Chỉ note SỐNG của owner.
   * KHÔNG bump updated_at.
   */
  setShareToken(
    ownerId: string,
    id: string,
    token: string | null,
  ): Promise<Note | null>;

  /** Tra note theo share_token (public — KHÔNG cần ownerId); note đã soft-delete → null. */
  findByShareToken(token: string): Promise<Note | null>;

  // ── Tags ─────────────────────────────────────────────────────────────
  /**
   * Tags của owner kèm count = số note ĐANG SỐNG mang tag đó.
   * Chỉ trả về tag có ≥ 1 note sống (JOIN nội); sắp theo name ASC.
   */
  listTagsWithCount(ownerId: string): Promise<TagCount[]>;

  /**
   * Gán lại toàn bộ tag cho note: xoá hết link cũ → upsert từng tag (theo ownerId) → link lại.
   * names = [] → chỉ xoá hết link. Note không tồn tại / không thuộc owner / đã soft-delete → no-op.
   * Thao tác ATOMIC (transaction ở cả 2 driver).
   */
  replaceNoteTags(
    ownerId: string,
    noteId: string,
    names: string[],
  ): Promise<void>;

  /**
   * Xoá HẲN tag (theo ownerId + name); link note_tags tự xoá theo CASCADE.
   * true khi XOÁ ĐƯỢC một dòng tag thuộc ownerId + name; false khi tag không
   * tồn tại / không thuộc owner (idempotent — gọi lại trả false).
   */
  removeTag(ownerId: string, name: string): Promise<boolean>;

  /**
   * Danh sách tên tag của 1 note (sorted ASC). KHÔNG lọc owner — tiện ích đọc cho caller
   * đã chứng minh quyền sở hữu note; note không tag → [].
   */
  findNoteTags(noteId: string): Promise<string[]>;
}

/** Chuẩn hoá timestamp về ISO string (sqlite TEXT / pg Date / PostgREST timestamptz "+00:00") */
function normalizeTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** Map dòng notes (snake_case) → Note (camelCase); cột NULL giữ nguyên là null */
export function mapNoteRow(row: NoteRow): Note {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    content: row.content,
    status: row.status as NoteStatus,
    deletedAt: row.deleted_at ? normalizeTimestamp(row.deleted_at) : null,
    shareToken: row.share_token ?? null,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

/** Map dòng { name } (JOIN note_tags→tags) → tên tag */
export function mapTagNameRow(row: TagNameRow): string {
  return row.name;
}

/** Map dòng { name, count } → TagCount; ép count sang number (pg COUNT(*) trả string int8) */
export function mapTagCountRow(row: {
  name: string;
  count: number | string;
}): TagCount {
  return { name: row.name, count: Number(row.count) };
}

// ── DDL dùng chung cho SQLite (PG tự viết DDL TIMESTAMPTZ riêng) ──────

export const CREATE_NOTES_TABLE = `
  CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id),
    title       TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published')),
    deleted_at  TEXT,
    share_token TEXT UNIQUE,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )
`;

export const CREATE_TAGS_TABLE = `
  CREATE TABLE IF NOT EXISTS tags (
    id       TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    UNIQUE (owner_id, name)
  )
`;

export const CREATE_NOTE_TAGS_TABLE = `
  CREATE TABLE IF NOT EXISTS note_tags (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
  )
`;

export const CREATE_NOTE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_notes_owner_id      ON notes (owner_id);
  CREATE INDEX IF NOT EXISTS idx_notes_owner_updated ON notes (owner_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notes_owner_deleted ON notes (owner_id, deleted_at);
`;
