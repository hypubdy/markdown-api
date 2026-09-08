import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  CreateNoteInput,
  Note,
  NoteListFilters,
  NoteListResult,
  UpdateNoteInput,
} from "../types/index";
import {
  mapNoteRow,
  mapTagCountRow,
  mapTagNameRow,
  NOTE_SELECT_COLUMNS,
  type NoteRepository,
  type NoteRow,
  type TagNameRow,
} from "./note.repository";

/** DDL riêng cho PG: timestamp TIMESTAMPTZ (không dùng hằng SQLite) */
const CREATE_NOTE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id),
    title       TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published')),
    deleted_at  TIMESTAMPTZ,
    share_token TEXT UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS tags (
    id       TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    UNIQUE (owner_id, name)
  );
  CREATE TABLE IF NOT EXISTS note_tags (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
  );
  CREATE INDEX IF NOT EXISTS idx_notes_owner_id      ON notes (owner_id);
  CREATE INDEX IF NOT EXISTS idx_notes_owner_updated ON notes (owner_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notes_owner_deleted ON notes (owner_id, deleted_at);
`;

/** Chạy một khối trong transaction; tự ROLLBACK khi lỗi rồi ném lại */
async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection đã hỏng — bỏ qua rollback lỗi
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Driver POSTGRESQL (pg) — dùng cho chạy thật (production/dev có DB server).
 * DÙNG CHUNG Pool với PgUserRepository.
 * Cấu hình qua env: DB_DRIVER=postgres + DATABASE_URL.
 */
export class PgNoteRepository implements NoteRepository {
  constructor(private readonly pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(CREATE_NOTE_TABLES_SQL);
  }

  async create(input: CreateNoteInput): Promise<Note> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(
      `INSERT INTO notes (id, owner_id, title, content, status, deleted_at, share_token, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7)
       RETURNING ${NOTE_SELECT_COLUMNS}`,
      [
        randomUUID(),
        input.ownerId,
        input.title,
        input.content ?? "",
        input.status ?? "draft",
        now,
        now,
      ],
    );
    return mapNoteRow(rows[0] as NoteRow);
  }

  async findById(ownerId: string, id: string): Promise<Note | null> {
    const { rows } = await this.pool.query(
      `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [id, ownerId],
    );
    return rows[0] ? mapNoteRow(rows[0] as NoteRow) : null;
  }

  async list(filters: NoteListFilters): Promise<NoteListResult> {
    // Mệnh đề cố định: owner_id luôn là tham số $1
    const clauses: string[] = ["owner_id = $1", "deleted_at IS NULL"];
    const params: Array<string | number> = [filters.ownerId];
    let idx = 1;

    /** Thêm mệnh đề chứa "?" — mỗi dấu ? trở thành $idx tăng dần */
    const addClause = (sql: string, ...values: Array<string | number>) => {
      const segments = sql.split("?");
      let built = segments[0];
      for (let i = 1; i < segments.length; i += 1) {
        idx += 1;
        built += `$${idx}${segments[i]}`;
      }
      clauses.push(built);
      params.push(...values);
    };

    if (filters.q && filters.q.trim().length > 0) {
      const q = `%${filters.q}%`;
      // LOWER(...) LIKE LOWER(?) cho hành vi đồng nhất 2 driver (không cần ILIKE)
      addClause(
        "(LOWER(title) LIKE LOWER(?) OR LOWER(content) LIKE LOWER(?))",
        q,
        q,
      );
    }
    if (filters.status) {
      addClause("status = ?", filters.status);
    }
    if (filters.tag && filters.tag.trim().length > 0) {
      // t.owner_id = $1 — chặn tag cùng tên của user khác
      addClause(
        `EXISTS (
           SELECT 1 FROM note_tags nt
           JOIN tags t ON t.id = nt.tag_id
           WHERE nt.note_id = notes.id AND t.name = ? AND t.owner_id = $1
         )`,
        filters.tag,
      );
    }

    const whereSql = clauses.join(" AND ");
    const { page, limit } = filters;
    const offset = (page - 1) * limit;

    const { rows } = await this.pool.query(
      `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
       WHERE ${whereSql}
       ORDER BY updated_at DESC
       LIMIT $${idx + 1} OFFSET $${idx + 2}`,
      [...params, limit, offset],
    );
    const totalResult = await this.pool.query(
      `SELECT COUNT(*) AS total FROM notes WHERE ${whereSql}`,
      params,
    );
    return {
      items: rows.map((row) => mapNoteRow(row as NoteRow)),
      total: Number((totalResult.rows[0] as { total: string })?.total ?? 0),
    };
  }

  async listTrash(ownerId: string): Promise<Note[]> {
    const { rows } = await this.pool.query(
      `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
       WHERE owner_id = $1 AND deleted_at IS NOT NULL
       ORDER BY updated_at DESC`,
      [ownerId],
    );
    return rows.map((row) => mapNoteRow(row as NoteRow));
  }

  async update(
    ownerId: string,
    id: string,
    changes: UpdateNoteInput,
  ): Promise<Note | null> {
    const sets: string[] = [];
    const params: Array<string | number> = [];
    let idx = 1;
    if (changes.title !== undefined) {
      sets.push(`title = $${idx++}`);
      params.push(changes.title);
    }
    if (changes.content !== undefined) {
      sets.push(`content = $${idx++}`);
      params.push(changes.content);
    }
    if (changes.status !== undefined) {
      sets.push(`status = $${idx++}`);
      params.push(changes.status);
    }
    sets.push(`updated_at = $${idx++}`);
    params.push(new Date().toISOString());
    params.push(id, ownerId);

    const { rows } = await this.pool.query(
      `UPDATE notes SET ${sets.join(", ")}
       WHERE id = $${idx} AND owner_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING ${NOTE_SELECT_COLUMNS}`,
      params,
    );
    return rows[0] ? mapNoteRow(rows[0] as NoteRow) : null;
  }

  async softDelete(ownerId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE notes SET deleted_at = now()
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [id, ownerId],
    );
    return (rowCount ?? 0) > 0;
  }

  async restore(ownerId: string, id: string): Promise<Note | null> {
    const { rowCount } = await this.pool.query(
      `UPDATE notes SET deleted_at = NULL
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL`,
      [id, ownerId],
    );
    if ((rowCount ?? 0) === 0) return null;
    const { rows } = await this.pool.query(
      `SELECT ${NOTE_SELECT_COLUMNS} FROM notes WHERE id = $1 AND owner_id = $2`,
      [id, ownerId],
    );
    return rows[0] ? mapNoteRow(rows[0] as NoteRow) : null;
  }

  async hardDelete(ownerId: string, id: string): Promise<boolean> {
    // Transaction: xoá luôn link note_tags rồi mới xoá note (2 bảng)
    return withTransaction(this.pool, async (client) => {
      await client.query("DELETE FROM note_tags WHERE note_id = $1", [id]);
      const result = await client.query(
        "DELETE FROM notes WHERE id = $1 AND owner_id = $2",
        [id, ownerId],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async setShareToken(
    ownerId: string,
    id: string,
    token: string | null,
  ): Promise<Note | null> {
    const { rowCount } = await this.pool.query(
      `UPDATE notes SET share_token = $1
       WHERE id = $2 AND owner_id = $3 AND deleted_at IS NULL`,
      [token, id, ownerId],
    );
    if ((rowCount ?? 0) === 0) return null;
    const { rows } = await this.pool.query(
      `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [id, ownerId],
    );
    return rows[0] ? mapNoteRow(rows[0] as NoteRow) : null;
  }

  async findByShareToken(token: string): Promise<Note | null> {
    const { rows } = await this.pool.query(
      `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
       WHERE share_token = $1 AND deleted_at IS NULL`,
      [token],
    );
    return rows[0] ? mapNoteRow(rows[0] as NoteRow) : null;
  }

  async listTagsWithCount(ownerId: string) {
    const { rows } = await this.pool.query(
      `SELECT t.name AS name, COUNT(n.id)::int AS count
       FROM tags t
       JOIN note_tags nt ON nt.tag_id = t.id
       JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
       WHERE t.owner_id = $1
       GROUP BY t.id, t.name
       ORDER BY t.name ASC`,
      [ownerId],
    );
    return rows.map((row) => mapTagCountRow(row as { name: string; count: number | string }));
  }

  async replaceNoteTags(
    ownerId: string,
    noteId: string,
    names: string[],
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const live = await client.query(
        `SELECT 1 AS live FROM notes
         WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [noteId, ownerId],
      );
      if ((live.rowCount ?? 0) === 0) return; // no-op (không tạo tag lạ)

      await client.query("DELETE FROM note_tags WHERE note_id = $1", [noteId]);
      const uniqueNames = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
      for (const name of uniqueNames) {
        await client.query(
          `INSERT INTO tags (id, owner_id, name) VALUES ($1, $2, $3)
           ON CONFLICT (owner_id, name) DO NOTHING`,
          [randomUUID(), ownerId, name],
        );
        const tag = await client.query(
          "SELECT id FROM tags WHERE owner_id = $1 AND name = $2",
          [ownerId, name],
        );
        if (tag.rows[0]) {
          await client.query(
            `INSERT INTO note_tags (note_id, tag_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [noteId, (tag.rows[0] as { id: string }).id],
          );
        }
      }
    });
  }

  async removeTag(ownerId: string, name: string): Promise<boolean> {
    // link note_tags tự xoá qua ON DELETE CASCADE (DDL note_tags.tag_id REFERENCES tags(id))
    const result = await this.pool.query(
      "DELETE FROM tags WHERE owner_id = $1 AND name = $2",
      [ownerId, name],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findNoteTags(noteId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT t.name AS name FROM note_tags nt
       JOIN tags t ON t.id = nt.tag_id
       WHERE nt.note_id = $1
       ORDER BY t.name ASC`,
      [noteId],
    );
    return rows.map((row) => mapTagNameRow(row as TagNameRow));
  }
}
