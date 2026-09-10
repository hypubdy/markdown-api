import type { AppContext } from "../../types/hono";
import type { Note } from "../../types/index";
import { validated } from "../../middleware/validate.middleware";
import { ApiError } from "../../utils/ApiError";
import type { CreateNoteBody, ListNotesQuery, UpdateNoteBody } from "./notes.schemas";

type SafeNote = Note & { tags: string[] };
const toSafeNote = (note: Note, tags: string[]): SafeNote => ({ ...note, tags });
type NoteListItem = Pick<Note, "id" | "title" | "status" | "createdAt" | "updatedAt"> & { tags: string[] };

async function toListItem(c: AppContext, note: Note): Promise<NoteListItem> {
  const tags = await (await c.get("services").getNoteRepository()).findNoteTags(note.id);
  return { id: note.id, title: note.title, status: note.status, tags, createdAt: note.createdAt, updatedAt: note.updatedAt };
}
const userId = (c: AppContext) => c.get("user")!.id;
const noteId = (c: AppContext) => validated<{ id: string }>(c, "params").id;

export async function createNote(c: AppContext) {
  const body = validated<CreateNoteBody>(c, "body");
  const repo = await c.get("services").getNoteRepository();
  const note = await repo.create({ ownerId: userId(c), title: body.title, content: body.content ?? "", status: body.status });
  if (body.tagNames?.length) await repo.replaceNoteTags(userId(c), note.id, body.tagNames);
  return c.json({ success: true, message: "Đã tạo ghi chú", data: toSafeNote(note, await repo.findNoteTags(note.id)) }, 201);
}

export async function listNotes(c: AppContext) {
  const query = validated<ListNotesQuery>(c, "query");
  const repo = await c.get("services").getNoteRepository();
  const { items } = await repo.list({ ownerId: userId(c), q: query.q, status: query.status, tag: query.tag, page: query.page, limit: query.limit });
  return c.json({ success: true, data: await Promise.all(items.map((note) => toListItem(c, note))) });
}

export async function listTrashNotes(c: AppContext) {
  return c.json({ success: true, data: await Promise.all((await (await c.get("services").getNoteRepository()).listTrash(userId(c))).map((note) => toListItem(c, note))) });
}

export async function getNote(c: AppContext) {
  const repo = await c.get("services").getNoteRepository();
  const note = await repo.findById(userId(c), noteId(c));
  if (!note) throw ApiError.notFound("Không tìm thấy ghi chú");
  return c.json({ success: true, data: toSafeNote(note, await repo.findNoteTags(note.id)) });
}

export async function getRawNote(c: AppContext) {
  const note = await (await c.get("services").getNoteRepository()).findById(userId(c), noteId(c));
  if (!note) throw ApiError.notFound("Không tìm thấy ghi chú");
  return c.text(note.content, 200, { "Content-Type": "text/markdown; charset=utf-8" });
}

export async function updateNote(c: AppContext) {
  const body = validated<UpdateNoteBody>(c, "body");
  const id = noteId(c);
  const repo = await c.get("services").getNoteRepository();
  const changes: { title?: string; content?: string; status?: Note["status"] } = {};
  if (body.title !== undefined) changes.title = body.title;
  if (body.content !== undefined) changes.content = body.content;
  if (body.status !== undefined) changes.status = body.status;
  const note = await repo.update(userId(c), id, changes);
  if (!note) throw ApiError.notFound("Không tìm thấy ghi chú");
  if (body.tagNames !== undefined) await repo.replaceNoteTags(userId(c), id, body.tagNames);
  return c.json({ success: true, message: "Đã cập nhật ghi chú", data: toSafeNote(note, await repo.findNoteTags(id)) });
}

export async function softDeleteNote(c: AppContext) {
  if (!(await (await c.get("services").getNoteRepository()).softDelete(userId(c), noteId(c)))) throw ApiError.notFound("Không tìm thấy ghi chú");
  return c.body(null, 204);
}

export async function restoreNote(c: AppContext) {
  const repo = await c.get("services").getNoteRepository();
  const note = await repo.restore(userId(c), noteId(c));
  if (!note) throw ApiError.notFound("Không tìm thấy ghi chú trong thùng rác");
  return c.json({ success: true, message: "Đã khôi phục ghi chú", data: toSafeNote(note, await repo.findNoteTags(note.id)) });
}

export async function hardDeleteNote(c: AppContext) {
  if (!(await (await c.get("services").getNoteRepository()).hardDelete(userId(c), noteId(c)))) throw ApiError.notFound("Không tìm thấy ghi chú trong thùng rác");
  return c.body(null, 204);
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (v) => v.toString(16).padStart(2, "0")).join("");
}

export async function enableShare(c: AppContext) {
  const note = await (await c.get("services").getNoteRepository()).setShareToken(userId(c), noteId(c), randomHex(16));
  if (!note) throw ApiError.notFound("Không tìm thấy ghi chú");
  const url = new URL(`/api/v1/public/notes/${note.shareToken}`, c.req.url).toString();
  return c.json({ success: true, data: { shareToken: note.shareToken, url } });
}

export async function disableShare(c: AppContext) {
  const note = await (await c.get("services").getNoteRepository()).setShareToken(userId(c), noteId(c), null);
  if (!note) throw ApiError.notFound("Không tìm thấy ghi chú");
  return c.json({ success: true, data: { shareToken: note.shareToken } });
}


