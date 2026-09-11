import { randomUUID } from "node:crypto";
import type { PostgrestClient } from "@supabase/postgrest-js";
import type {
  CreateNoteInput,
  Note,
  NoteListFilters,
  NoteListResult,
  TagCount,
  UpdateNoteInput,
} from "../types/index";
import {
  mapNoteRow,
  mapTagNameRow,
  NOTE_SELECT_COLUMNS,
  type NoteRepository,
  type NoteRow,
  type TagNameRow,
} from "./note.repository";

/**
 * Driver SUPABASE (PostgREST qua @supabase/postgrest-js) — dùng cho chạy thật và
 * chạy được trên Cloudflare Worker (fetch-based, không cần TCP socket).
 *
 * Cấu hình qua env: DB_DRIVER=supabase + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * DÙNG CHUNG client với SupabaseUserRepository.
 *
 * LƯU Ý:
 * - `init()` là no-op — bảng được tạo bởi `supabase/schema.sql` (chạy 1 lần).
 * - PostgREST là HTTP stateless, nên KHÔNG có transaction như driver SQL.
 *   `replaceNoteTags()` là BEST-EFFORT (xoá link cũ → thêm từng tag mới); nếu một
 *   request giữa chừng lỗi, dữ liệu có thể ở trạng thái trung gian. Với ứng dụng
 *   demo/CRUD thông thường thì chấp nhận được.
 */
export class SupabaseNoteRepository implements NoteRepository {
  constructor(private readonly sb: PostgrestClient) {}

  /** PostgREST không hỗ trợ DDL — bảng đã được tạo bởi supabase/schema.sql (HEAD check nhẹ). */
  async init(): Promise<void> {
    const { error } = await this.sb.from("notes").select("id", { head: true });
    if (error) {
      throw new Error(
        `Supabase không truy vấn được bảng notes (đã chạy supabase/schema.sql chưa?): ${error.message}`,
      );
    }
  }

  async create(input: CreateNoteInput): Promise<Note> {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      owner_id: input.ownerId,
      title: input.title,
      content: input.content ?? "",
      status: input.status ?? "draft",
      deleted_at: null,
      share_token: null,
      created_at: now,
      updated_at: now,
    };
    const { data, error } = await this.sb
      .from("notes")
      .insert(row)
      .select(NOTE_SELECT_COLUMNS);
    if (error) throw error;
    return mapNoteRow((data as NoteRow[])[0]);
  }

  async findById(ownerId: string, id: string): Promise<Note | null> {
    const { data, error } = await this.sb
      .from("notes")
      .select(NOTE_SELECT_COLUMNS)
      .eq("id", id)
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data ? mapNoteRow(data as NoteRow) : null;
  }

  async list(filters: NoteListFilters): Promise<NoteListResult> {
    const { ownerId, q, status, tag, page, limit } = filters;

    let query = this.sb
      .from("notes")
      .select(NOTE_SELECT_COLUMNS, { count: "exact" })
      .eq("owner_id", ownerId)
      .is("deleted_at", null);

    if (q && q.trim().length > 0) {
      const pattern = `*${sanitizeLike(q.trim())}*`;
      // ilike = LIKE không phân biệt hoa/thường; '*' trong PostgREST là '%'
      query = query.or(`title.ilike.${pattern},content.ilike.${pattern}`);
    }

    if (status) {
      query = query.eq("status", status);
    }

    // Lọc theo tag: tìm id tag của owner → các note đang mang tag đó → IN(id).
    if (tag && tag.trim().length > 0) {
      const ids = await this.resolveTagNoteIds(ownerId, tag.trim());
      if (!ids) return { items: [], total: 0 }; // tag không tồn tại của owner
      if (ids.length === 0) return { items: [], total: 0 };
      query = query.in("id", ids);
    }

    const offset = (page - 1) * limit;
    const { data, count, error } = await query
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return {
      items: (data as NoteRow[]).map(mapNoteRow),
      total: Number(count ?? 0),
    };
  }

  async listTrash(ownerId: string): Promise<Note[]> {
    const { data, error } = await this.sb
      .from("notes")
      .select(NOTE_SELECT_COLUMNS)
      .eq("owner_id", ownerId)
      .not("deleted_at", "is", null)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data as NoteRow[]).map(mapNoteRow);
  }

  async update(
    ownerId: string,
    id: string,
    changes: UpdateNoteInput,
  ): Promise<Note | null> {
    const patch: Record<string, string> = { updated_at: new Date().toISOString() };
    if (changes.title !== undefined) patch.title = changes.title;
    if (changes.content !== undefined) patch.content = changes.content;
    if (changes.status !== undefined) patch.status = changes.status;

    const { data, error } = await this.sb
      .from("notes")
      .update(patch)
      .eq("id", id)
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .select(NOTE_SELECT_COLUMNS);
    if (error) throw error;
    const row = (data as NoteRow[] | null)?.[0];
    return row ? mapNoteRow(row) : null;
  }

  async softDelete(ownerId: string, id: string): Promise<boolean> {
    const { data, error } = await this.sb
      .from("notes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .select("id");
    if (error) throw error;
    return ((data as { id: string }[] | null)?.length ?? 0) > 0;
  }

  async restore(ownerId: string, id: string): Promise<Note | null> {
    const { data, error } = await this.sb
      .from("notes")
      .update({ deleted_at: null })
      .eq("id", id)
      .eq("owner_id", ownerId)
      .not("deleted_at", "is", null)
      .select(NOTE_SELECT_COLUMNS);
    if (error) throw error;
    const row = (data as NoteRow[] | null)?.[0];
    return row ? mapNoteRow(row) : null;
  }

  async hardDelete(ownerId: string, id: string): Promise<boolean> {
    // note_tags tự xoá theo ON DELETE CASCADE (xem supabase/schema.sql)
    const { data, error } = await this.sb
      .from("notes")
      .delete()
      .eq("id", id)
      .eq("owner_id", ownerId)
      .select("id");
    if (error) throw error;
    return ((data as { id: string }[] | null)?.length ?? 0) > 0;
  }

  async setShareToken(
    ownerId: string,
    id: string,
    token: string | null,
  ): Promise<Note | null> {
    const { data, error } = await this.sb
      .from("notes")
      .update({ share_token: token })
      .eq("id", id)
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .select(NOTE_SELECT_COLUMNS);
    if (error) throw error;
    const row = (data as NoteRow[] | null)?.[0];
    return row ? mapNoteRow(row) : null;
  }

  async findByShareToken(token: string): Promise<Note | null> {
    const { data, error } = await this.sb
      .from("notes")
      .select(NOTE_SELECT_COLUMNS)
      .eq("share_token", token)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data ? mapNoteRow(data as NoteRow) : null;
  }

  async listTagsWithCount(ownerId: string): Promise<TagCount[]> {
    // Lấy toàn bộ note ĐANG SỐNG của owner kèm tag (nested qua note_tags→tags),
    // rồi đếm trong JS; tag không còn note sống sẽ có count = 0.
    const { data, error } = await this.sb
      .from("notes")
      .select("id, note_tags(tags(name))")
      .eq("owner_id", ownerId)
      .is("deleted_at", null);
    if (error) throw error;

    const counts = new Map<string, number>();
    const { data: allTags, error: allTagsError } = await this.sb
      .from("tags")
      .select("name")
      .eq("owner_id", ownerId);
    if (allTagsError) throw allTagsError;
    for (const tag of (allTags as Array<{ name: string }> | null) ?? []) {
      counts.set(tag.name, 0);
    }
    const notes = (data as Array<{ note_tags?: unknown }> | null) ?? [];
    for (const note of notes) {
      const tags = (note.note_tags ?? []) as Array<{
        tags?: { name?: string } | Array<{ name?: string }>;
      }>;
      for (const link of tags) {
        const t = link.tags;
        const name = Array.isArray(t) ? t[0]?.name : t?.name;
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async replaceNoteTags(
    ownerId: string,
    noteId: string,
    names: string[],
  ): Promise<void> {
    // No-op nếu note không thuộc owner / không tồn tại / đã soft-delete
    const { data: live, error: liveErr } = await this.sb
      .from("notes")
      .select("id")
      .eq("id", noteId)
      .eq("owner_id", ownerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (liveErr) throw liveErr;
    if (!live) return;

    // Xoá hết link cũ rồi upsert từng tag + link lại (BEST-EFFORT, không atomic).
    const { error: delErr } = await this.sb
      .from("note_tags")
      .delete()
      .eq("note_id", noteId);
    if (delErr) throw delErr;

    const uniqueNames = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    for (const name of uniqueNames) {
      const tagId = await this.ensureTag(ownerId, name);
      const { error: linkErr } = await this.sb
        .from("note_tags")
        .upsert(
          { note_id: noteId, tag_id: tagId },
          { onConflict: "note_id,tag_id", ignoreDuplicates: true },
        );
      if (linkErr) throw linkErr;
    }
  }

  async removeTag(ownerId: string, name: string): Promise<boolean> {
    // link note_tags tự xoá theo ON DELETE CASCADE
    const { data, error } = await this.sb
      .from("tags")
      .delete()
      .eq("owner_id", ownerId)
      .eq("name", name)
      .select("id");
    if (error) throw error;
    return ((data as { id: string }[] | null)?.length ?? 0) > 0;
  }

  async findNoteTags(noteId: string): Promise<string[]> {
    const { data, error } = await this.sb
      .from("note_tags")
      .select("tags(name)")
      .eq("note_id", noteId)
      .order("name", { referencedTable: "tags", ascending: true });
    if (error) throw error;
    return ((data as Array<{ tags?: { name?: string } }> | null)
      ?.map((row) => (row.tags as { name?: string } | undefined)?.name)
      .filter((n): n is string => Boolean(n)) ?? []).sort((a, b) => a.localeCompare(b));
  }

  /** Trả về [] nếu tag không tồn tại của owner; null nghĩa là "không có tag này" (gọi lấy dữ liệu dạng lọc). */
  private async resolveTagNoteIds(
    ownerId: string,
    name: string,
  ): Promise<string[] | null> {
    const { data: tag, error: tagErr } = await this.sb
      .from("tags")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("name", name)
      .maybeSingle();
    if (tagErr) throw tagErr;
    if (!tag) return null;

    const { data: links, error: linksErr } = await this.sb
      .from("note_tags")
      .select("note_id")
      .eq("tag_id", (tag as { id: string }).id);
    if (linksErr) throw linksErr;
    return (links as Array<{ note_id: string }> | null)?.map((l) => l.note_id) ?? [];
  }

  /** Bảo đảm tag tồn tại (theo owner+name) rồi trả về id của nó. */
  private async ensureTag(ownerId: string, name: string): Promise<string> {
    const { data: existing, error: selErr } = await this.sb
      .from("tags")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("name", name)
      .maybeSingle();
    if (selErr) throw selErr;
    if (existing) return (existing as { id: string }).id;

    const id = randomUUID();
    const { data: inserted, error: insErr } = await this.sb
      .from("tags")
      .insert({ id, owner_id: ownerId, name })
      .select("id");
    if (insErr) throw insErr;
    return (inserted as Array<{ id: string }>)[0].id;
  }
}

/** Loại bỏ ký tự đặc biệt của PostgREST filter khỏi chuỗi tìm kiếm trước khi nhét vào LIKE. */
function sanitizeLike(value: string): string {
  return value.replace(/[*%_,.()"']/g, "");
}
