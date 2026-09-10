import type { D1Database } from "@cloudflare/workers-types";
import { CreateNoteInput, Note, NoteListFilters, NoteListResult, UpdateNoteInput } from "../types/index";
import {
  mapNoteRow,
  mapTagCountRow,
  mapTagNameRow,
  NOTE_SELECT_COLUMNS,
  type NoteRepository,
  type NoteRow,
  type TagNameRow,
} from "./note.repository";

/** Cloudflare D1 repository. Uses prepared statements and D1 batch transactions. */
export class D1NoteRepository implements NoteRepository {
  constructor(private readonly db: D1Database) {}

  async init(): Promise<void> {
    // D1 migrations run before deploy/request handling; never run DDL per request.
  }

  async create(input: CreateNoteInput): Promise<Note> {
    const now = new Date().toISOString();
    const note: Note = {
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      title: input.title,
      content: input.content ?? "",
      status: input.status ?? "draft",
      deletedAt: null,
      shareToken: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db
      .prepare(
        `INSERT INTO notes
          (id, owner_id, title, content, status, deleted_at, share_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        note.id,
        note.ownerId,
        note.title,
        note.content,
        note.status,
        null,
        null,
        note.createdAt,
        note.updatedAt,
      )
      .run();

    return note;
  }

  async findById(ownerId: string, id: string): Promise<Note | null> {
    const row = await this.db
      .prepare(
        `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
         WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
      )
      .bind(id, ownerId)
      .first<NoteRow>();
    return row ? mapNoteRow(row) : null;
  }

  async list(filters: NoteListFilters): Promise<NoteListResult> {
    const whereParts = ["owner_id = ?", "deleted_at IS NULL"];
    const params: Array<string | number> = [filters.ownerId];

    if (filters.q && filters.q.trim().length > 0) {
      const q = `%${filters.q}%`;
      whereParts.push("(LOWER(title) LIKE LOWER(?) OR LOWER(content) LIKE LOWER(?))");
      params.push(q, q);
    }
    if (filters.status) {
      whereParts.push("status = ?");
      params.push(filters.status);
    }
    if (filters.tag && filters.tag.trim().length > 0) {
      whereParts.push(`EXISTS (
        SELECT 1 FROM note_tags nt
        JOIN tags t ON t.id = nt.tag_id
        WHERE nt.note_id = notes.id AND t.name = ? AND t.owner_id = ?
      )`);
      params.push(filters.tag, filters.ownerId);
    }

    const whereSql = whereParts.join(" AND ");
    const offset = (filters.page - 1) * filters.limit;
    const [rowsResult, totalResult] = await this.db.batch<NoteRow | { total: number }>([
      this.db
        .prepare(
          `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
           WHERE ${whereSql}
           ORDER BY updated_at DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(...params, filters.limit, offset),
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM notes WHERE ${whereSql}`)
        .bind(...params),
    ]);

    return {
      items: (rowsResult.results as NoteRow[]).map(mapNoteRow),
      total: Number((totalResult.results[0] as { total?: number } | undefined)?.total ?? 0),
    };
  }

  async listTrash(ownerId: string): Promise<Note[]> {
    const result = await this.db
      .prepare(
        `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
         WHERE owner_id = ? AND deleted_at IS NOT NULL
         ORDER BY updated_at DESC`,
      )
      .bind(ownerId)
      .all<NoteRow>();
    return result.results.map(mapNoteRow);
  }

  async update(ownerId: string, id: string, changes: UpdateNoteInput): Promise<Note | null> {
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
    params.push(new Date().toISOString(), id, ownerId);

    const result = await this.db
      .prepare(
        `UPDATE notes SET ${sets.join(", ")}
         WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
      )
      .bind(...params)
      .run();
    return result.meta.changes > 0 ? this.findById(ownerId, id) : null;
  }

  async softDelete(ownerId: string, id: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE notes SET deleted_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL",
      )
      .bind(new Date().toISOString(), id, ownerId)
      .run();
    return result.meta.changes > 0;
  }

  async restore(ownerId: string, id: string): Promise<Note | null> {
    const result = await this.db
      .prepare(
        "UPDATE notes SET deleted_at = NULL WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL",
      )
      .bind(id, ownerId)
      .run();
    if (result.meta.changes === 0) return null;
    return this.findById(ownerId, id);
  }

  async hardDelete(ownerId: string, id: string): Promise<boolean> {
    const results = await this.db.batch([
      this.db.prepare(
        "DELETE FROM note_tags WHERE note_id IN (SELECT id FROM notes WHERE id = ? AND owner_id = ?)",
      ).bind(id, ownerId),
      this.db.prepare("DELETE FROM notes WHERE id = ? AND owner_id = ?").bind(id, ownerId),
    ]);
    return results[1].meta.changes > 0;
  }

  async setShareToken(ownerId: string, id: string, token: string | null): Promise<Note | null> {
    const result = await this.db
      .prepare(
        "UPDATE notes SET share_token = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL",
      )
      .bind(token, id, ownerId)
      .run();
    return result.meta.changes > 0 ? this.findById(ownerId, id) : null;
  }

  async findByShareToken(token: string): Promise<Note | null> {
    const row = await this.db
      .prepare(
        `SELECT ${NOTE_SELECT_COLUMNS} FROM notes
         WHERE share_token = ? AND deleted_at IS NULL`,
      )
      .bind(token)
      .first<NoteRow>();
    return row ? mapNoteRow(row) : null;
  }

  async listTagsWithCount(ownerId: string) {
    const result = await this.db
      .prepare(
        `SELECT t.name AS name, COUNT(n.id) AS count
         FROM tags t
         JOIN note_tags nt ON nt.tag_id = t.id
         JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
         WHERE t.owner_id = ?
         GROUP BY t.id, t.name
         ORDER BY t.name ASC`,
      )
      .bind(ownerId)
      .all<{ name: string; count: number | string }>();
    return result.results.map(mapTagCountRow);
  }

  async replaceNoteTags(ownerId: string, noteId: string, names: string[]): Promise<void> {
    const live = await this.db
      .prepare("SELECT 1 AS live FROM notes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
      .bind(noteId, ownerId)
      .first();
    if (!live) return;

    const uniqueNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    const statements = [
      this.db.prepare("DELETE FROM note_tags WHERE note_id = ?").bind(noteId),
    ];
    for (const name of uniqueNames) {
      statements.push(
        this.db
          .prepare("INSERT OR IGNORE INTO tags (id, owner_id, name) VALUES (?, ?, ?)")
          .bind(crypto.randomUUID(), ownerId, name),
        this.db
          .prepare(
            `INSERT OR IGNORE INTO note_tags (note_id, tag_id)
             SELECT ?, id FROM tags WHERE owner_id = ? AND name = ?`,
          )
          .bind(noteId, ownerId, name),
      );
    }
    await this.db.batch(statements);
  }

  async removeTag(ownerId: string, name: string): Promise<boolean> {
    const tag = await this.db
      .prepare("SELECT id FROM tags WHERE owner_id = ? AND name = ?")
      .bind(ownerId, name)
      .first<{ id: string }>();
    if (!tag) return false;

    const results = await this.db.batch([
      this.db.prepare("DELETE FROM note_tags WHERE tag_id = ?").bind(tag.id),
      this.db.prepare("DELETE FROM tags WHERE id = ? AND owner_id = ?").bind(tag.id, ownerId),
    ]);
    return results[1].meta.changes > 0;
  }

  async findNoteTags(noteId: string): Promise<string[]> {
    const result = await this.db
      .prepare(
        `SELECT t.name AS name FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id = ?
         ORDER BY t.name ASC`,
      )
      .bind(noteId)
      .all<TagNameRow>();
    return result.results.map(mapTagNameRow);
  }
}
