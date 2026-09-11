import { randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  CreateNoteInput,
  Note,
  NoteListFilters,
  NoteListResult,
  UpdateNoteInput,
} from "../types/index";
import {
  CREATE_NOTE_INDEXES,
  CREATE_NOTE_TAGS_TABLE,
  CREATE_NOTES_TABLE,
  CREATE_TAGS_TABLE,
  mapNoteRow,
  mapTagCountRow,
  mapTagNameRow,
  NOTE_SELECT_COLUMNS,
  type NoteRepository,
  type NoteRow,
  type TagNameRow,
} from "./note.repository";

/**
 * Driver SQLITE (node:sqlite — Node ≥ 22) — dùng cho TEST
 * (DB_FILE=":memory:" trong vitest.config.ts) và dev nhanh không cần DB server.
 * DÙNG CHUNG DatabaseSync với SqliteUserRepository (cùng connection).
 */
export class SqliteNoteRepository implements NoteRepository {
  private insertNoteStmt!: StatementSync;
  private selectByIdStmt!: StatementSync; // live + owner
  private selectTrashStmt!: StatementSync; // deleted + owner
  private selectAnyStmt!: StatementSync; // id + owner (không quan tâm deleted_at)
  private selectLiveCheckStmt!: StatementSync;
  private selectByShareTokenStmt!: StatementSync; // live
  private softDeleteStmt!: StatementSync;
  private restoreStmt!: StatementSync;
  private hardDeleteStmt!: StatementSync;
  private setShareTokenStmt!: StatementSync;
  private selectNoteTagsStmt!: StatementSync;
  private deleteNoteTagsStmt!: StatementSync;
  private insertTagStmt!: StatementSync;
  private selectTagStmt!: StatementSync;
  private insertNoteTagStmt!: StatementSync;
  private deleteTagStmt!: StatementSync;
  private initialized = false;

  constructor(private readonly db: DatabaseSync) {}

  /** Tạo bảng (nếu chưa có) + PRAGMA FK + chuẩn bị câu lệnh — chạy 1 lần */
  private ensure(): void {
    if (this.initialized) return;

    // Bắt buộc: cascade của note_tags và FK notes.owner_id→users được kiểm soát
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(CREATE_NOTES_TABLE);
    this.db.exec(CREATE_TAGS_TABLE);
    this.db.exec(CREATE_NOTE_TAGS_TABLE);
    this.db.exec(CREATE_NOTE_INDEXES);

    this.insertNoteStmt = this.db.prepare(
      `INSERT INTO notes (id, owner_id, title, content, status, deleted_at, share_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectByIdStmt = this.db.prepare(
      `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    );
    this.selectTrashStmt = this.db.prepare(
      `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
       WHERE owner_id = ? AND deleted_at IS NOT NULL
       ORDER BY updated_at DESC`,
    );
    this.selectAnyStmt = this.db.prepare(
      `SELECT ${NOTE_SELECT_COLUMNS} FROM notes WHERE id = ? AND owner_id = ?`,
    );
    this.selectLiveCheckStmt = this.db.prepare(
      `SELECT 1 AS live FROM notes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    );
    this.selectByShareTokenStmt = this.db.prepare(
      `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
       WHERE share_token = ? AND deleted_at IS NULL`,
    );
    this.softDeleteStmt = this.db.prepare(
      `UPDATE notes SET deleted_at = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    );
    this.restoreStmt = this.db.prepare(
      `UPDATE notes SET deleted_at = NULL
       WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL`,
    );
    this.hardDeleteStmt = this.db.prepare(
      `DELETE FROM notes WHERE id = ? AND owner_id = ?`,
    );
    this.setShareTokenStmt = this.db.prepare(
      `UPDATE notes SET share_token = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    );
    this.selectNoteTagsStmt = this.db.prepare(
      `SELECT t.name AS name FROM note_tags nt
       JOIN tags t ON t.id = nt.tag_id
       WHERE nt.note_id = ?
       ORDER BY t.name ASC`,
    );
    this.deleteNoteTagsStmt = this.db.prepare(
      `DELETE FROM note_tags WHERE note_id = ?`,
    );
    this.insertTagStmt = this.db.prepare(
      `INSERT OR IGNORE INTO tags (id, owner_id, name) VALUES (?, ?, ?)`,
    );
    this.selectTagStmt = this.db.prepare(
      `SELECT id FROM tags WHERE owner_id = ? AND name = ?`,
    );
    this.insertNoteTagStmt = this.db.prepare(
      `INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)`,
    );
    this.deleteTagStmt = this.db.prepare(
      `DELETE FROM tags WHERE owner_id = ? AND name = ?`,
    );

    this.initialized = true;
  }

  async init(): Promise<void> {
    this.ensure();
  }

  async create(input: CreateNoteInput): Promise<Note> {
    this.ensure();
    const now = new Date().toISOString();
    const note: Note = {
      id: randomUUID(),
      ownerId: input.ownerId,
      title: input.title,
      content: input.content ?? "",
      status: input.status ?? "draft",
      deletedAt: null,
      shareToken: null,
      createdAt: now,
      updatedAt: now,
    };
    this.insertNoteStmt.run(
      note.id,
      note.ownerId,
      note.title,
      note.content,
      note.status,
      null,
      null,
      note.createdAt,
      note.updatedAt,
    );
    return note;
  }

  async findById(ownerId: string, id: string): Promise<Note | null> {
    this.ensure();
    const row = this.selectByIdStmt.get(id, ownerId) as NoteRow | undefined;
    return row ? mapNoteRow(row) : null;
  }

  async list(filters: NoteListFilters): Promise<NoteListResult> {
    this.ensure();

    const whereParts = ["owner_id = ?", "deleted_at IS NULL"];
    const params: Array<string | number> = [filters.ownerId];

    if (filters.q && filters.q.trim().length > 0) {
      const q = `%${filters.q}%`;
      whereParts.push(
        "(LOWER(title) LIKE LOWER(?) OR LOWER(content) LIKE LOWER(?))",
      );
      params.push(q, q);
    }
    if (filters.status) {
      whereParts.push("status = ?");
      params.push(filters.status);
    }
    if (filters.tag && filters.tag.trim().length > 0) {
      whereParts.push(
        `EXISTS (
           SELECT 1 FROM note_tags nt
           JOIN tags t ON t.id = nt.tag_id
           WHERE nt.note_id = notes.id AND t.name = ? AND t.owner_id = ?
         )`,
      );
      params.push(filters.tag, filters.ownerId);
    }

    const whereSql = whereParts.join(" AND ");
    const { page, limit } = filters;
    const offset = (page - 1) * limit;

    const rows = this.db
      .prepare(
        `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
         WHERE ${whereSql}
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as unknown as NoteRow[];

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM notes WHERE ${whereSql}`)
      .get(...params) as { total: number | string } | undefined;

    return {
      items: rows.map(mapNoteRow),
      total: Number(totalRow?.total ?? 0),
    };
  }

  async listTrash(ownerId: string): Promise<Note[]> {
    this.ensure();
    const rows = this.selectTrashStmt.all(ownerId) as unknown as NoteRow[];
    return rows.map(mapNoteRow);
  }

  async update(
    ownerId: string,
    id: string,
    changes: UpdateNoteInput,
  ): Promise<Note | null> {
    this.ensure();

    const sets: string[] = [];
    const params: Array<string | number> = [];
    if (changes.title !== undefined) {
      sets.push("title = ?");
      params.push(changes.title);
    }
    if (changes.content !== undefined) {
      sets.push("content = ?");
      params.push(changes.content);
    }
    if (changes.status !== undefined) {
      sets.push("status = ?");
      params.push(changes.status);
    }
    sets.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(id, ownerId);

    const result = this.db
      .prepare(
        `UPDATE notes SET ${sets.join(", ")}
         WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
      )
      .run(...params);

    if (result.changes === 0) return null;

    const row = this.selectByIdStmt.get(id, ownerId) as NoteRow | undefined;
    return row ? mapNoteRow(row) : null;
  }

  async softDelete(ownerId: string, id: string): Promise<boolean> {
    this.ensure();
    const result = this.softDeleteStmt.run(new Date().toISOString(), id, ownerId);
    return result.changes > 0;
  }

  async restore(ownerId: string, id: string): Promise<Note | null> {
    this.ensure();
    const result = this.restoreStmt.run(id, ownerId);
    if (result.changes === 0) return null;
    const row = this.selectAnyStmt.get(id, ownerId) as NoteRow | undefined;
    return row ? mapNoteRow(row) : null;
  }

  async hardDelete(ownerId: string, id: string): Promise<boolean> {
    this.ensure();
    // note_tags tự xoá qua ON DELETE CASCADE (PRAGMA foreign_keys = ON)
    const result = this.hardDeleteStmt.run(id, ownerId);
    return result.changes > 0;
  }

  async setShareToken(
    ownerId: string,
    id: string,
    token: string | null,
  ): Promise<Note | null> {
    this.ensure();
    const result = this.setShareTokenStmt.run(token, id, ownerId);
    if (result.changes === 0) return null;
    const row = this.selectByIdStmt.get(id, ownerId) as NoteRow | undefined;
    return row ? mapNoteRow(row) : null;
  }

  async findByShareToken(token: string): Promise<Note | null> {
    this.ensure();
    const row = this.selectByShareTokenStmt.get(token) as NoteRow | undefined;
    return row ? mapNoteRow(row) : null;
  }

  async listTagsWithCount(ownerId: string) {
    this.ensure();
    const rows = this.db
      .prepare(
        `SELECT t.name AS name, COUNT(n.id) AS count
         FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id
         LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
         WHERE t.owner_id = ?
         GROUP BY t.id, t.name
         ORDER BY t.name ASC`,
      )
      .all(ownerId) as unknown as Array<{ name: string; count: number | string }>;
    return rows.map(mapTagCountRow);
  }

  async replaceNoteTags(
    ownerId: string,
    noteId: string,
    names: string[],
  ): Promise<void> {
    this.ensure();

    // No-op nếu note không tồn tại / không của owner / đã soft-delete
    if (!this.selectLiveCheckStmt.get(noteId, ownerId)) return;

    const uniqueNames = [...new Set(names.map((n) => n.trim()).filter(Boolean))];

    this.db.exec("BEGIN");
    try {
      this.deleteNoteTagsStmt.run(noteId);
      for (const name of uniqueNames) {
        this.insertTagStmt.run(randomUUID(), ownerId, name);
        const tagRow = this.selectTagStmt.get(ownerId, name) as
          | { id: string }
          | undefined;
        if (tagRow) {
          this.insertNoteTagStmt.run(noteId, tagRow.id);
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // đã rollback rồi — bỏ qua
      }
      throw error;
    }
  }

  async removeTag(ownerId: string, name: string): Promise<boolean> {
    this.ensure();
    // link note_tags tự xoá qua ON DELETE CASCADE (PRAGMA foreign_keys = ON)
    const result = this.deleteTagStmt.run(ownerId, name);
    return result.changes > 0;
  }

  async findNoteTags(noteId: string): Promise<string[]> {
    this.ensure();
    const rows = this.selectNoteTagsStmt.all(noteId) as unknown as TagNameRow[];
    return rows.map(mapTagNameRow);
  }
}
