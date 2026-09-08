import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { getNoteRepository } from "../../data/index";
import type { Note } from "../../types/index";
import { ApiError } from "../../utils/ApiError";
import type {
  CreateNoteBody,
  ListNotesQuery,
  UpdateNoteBody,
} from "./notes.schemas";

/**
 * ACTIONS của module notes — logic thuần, không biết gì về express Router.
 * Mọi truy vấn đều theo ownerId = req.user.id (authenticate cấp module).
 * Note của người khác / đã soft-delete được xử lý như KHÔNG TỒN TẠI → 404.
 */

/** Dạng ghi chú đầy đủ gửi ra ngoài: Note + tags — KHÔNG thêm trường nào khác */
type SafeNote = Note & { tags: string[] };

function toSafeNote(note: Note, tags: string[]): SafeNote {
  return { ...note, tags };
}

/** Dạng gọn cho danh sách: KHÔNG content, kèm tags */
type NoteListItem = Pick<
  Note,
  "id" | "title" | "status" | "createdAt" | "updatedAt"
> & { tags: string[] };

async function toListItem(note: Note): Promise<NoteListItem> {
  const repo = await getNoteRepository();
  const tags = await repo.findNoteTags(note.id);
  return {
    id: note.id,
    title: note.title,
    status: note.status,
    tags,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/** POST /notes — tạo note mới (kèm tagNames nếu có) → 201 */
export async function createNote(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateNoteBody;
  const ownerId = req.user!.id;
  const repo = await getNoteRepository();

  const note = await repo.create({
    ownerId,
    title: body.title,
    content: body.content ?? "",
    status: body.status,
  });

  if (body.tagNames && body.tagNames.length > 0) {
    await repo.replaceNoteTags(ownerId, note.id, body.tagNames);
  }
  const tags = await repo.findNoteTags(note.id);

  res.status(201).json({
    success: true,
    message: "Đã tạo ghi chú",
    data: toSafeNote(note, tags),
  });
}

/** GET /notes — danh sách note SỐNG của mình (lọc q/status/tag + phân trang) */
export async function listNotes(req: Request, res: Response): Promise<void> {
  // validate(listNotesQuerySchema) đã ghi đè req.query bằng dữ liệu đã parse
  const query = req.query as unknown as ListNotesQuery;
  const ownerId = req.user!.id;
  const repo = await getNoteRepository();

  const { items } = await repo.list({
    ownerId,
    q: query.q,
    status: query.status,
    tag: query.tag,
    page: query.page,
    limit: query.limit,
  });

  const data = await Promise.all(items.map(toListItem));
  res.json({ success: true, data });
}

/** GET /notes/trash — danh sách note đã soft-delete của mình */
export async function listTrashNotes(
  req: Request,
  res: Response,
): Promise<void> {
  const ownerId = req.user!.id;
  const repo = await getNoteRepository();
  const items = await repo.listTrash(ownerId);
  const data = await Promise.all(items.map(toListItem));
  res.json({ success: true, data });
}

/** GET /notes/:id — chi tiết 1 note SỐNG của mình (kèm content + tags) */
export async function getNote(req: Request, res: Response): Promise<void> {
  const ownerId = req.user!.id;
  const repo = await getNoteRepository();

  const note = await repo.findById(ownerId, req.params.id);
  if (!note) {
    throw ApiError.notFound("Không tìm thấy ghi chú");
  }
  const tags = await repo.findNoteTags(note.id);

  res.json({ success: true, data: toSafeNote(note, tags) });
}

/** GET /notes/:id/raw — nội dung markdown thuần (text/markdown, không JSON) */
export async function getRawNote(req: Request, res: Response): Promise<void> {
  const ownerId = req.user!.id;
  const repo = await getNoteRepository();

  const note = await repo.findById(ownerId, req.params.id);
  if (!note) {
    throw ApiError.notFound("Không tìm thấy ghi chú");
  }

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.send(note.content);
}

/** PATCH /notes/:id — sửa một phần note SỐNG (title/content/status/tagNames) */
export async function updateNote(req: Request, res: Response): Promise<void> {
  const body = req.body as UpdateNoteBody;
  const ownerId = req.user!.id;
  const id = req.params.id;
  const repo = await getNoteRepository();

  const changes: { title?: string; content?: string; status?: Note["status"] } =
    {};
  if (body.title !== undefined) changes.title = body.title;
  if (body.content !== undefined) changes.content = body.content;
  if (body.status !== undefined) changes.status = body.status;

  // Luôn chạy update (bump updated_at kể cả khi chỉ đổi tagNames)
  const note = await repo.update(ownerId, id, changes);
  if (!note) {
    throw ApiError.notFound("Không tìm thấy ghi chú");
  }

  if (body.tagNames !== undefined) {
    await repo.replaceNoteTags(ownerId, id, body.tagNames);
  }
  const tags = await repo.findNoteTags(id);

  res.json({
    success: true,
    message: "Đã cập nhật ghi chú",
    data: toSafeNote(note, tags),
  });
}

/** DELETE /notes/:id — soft-delete (vào thùng rác) → 204 */
export async function softDeleteNote(
  req: Request,
  res: Response,
): Promise<void> {
  const ownerId = req.user!.id;
  const repo = await getNoteRepository();

  const deleted = await repo.softDelete(ownerId, req.params.id);
  if (!deleted) {
    throw ApiError.notFound("Không tìm thấy ghi chú");
  }
  res.status(204).send();
}

/** POST /notes/trash/:id/restore — khôi phục note từ thùng rác */
export async function restoreNote(req: Request, res: Response): Promise<void> {
  const ownerId = req.user!.id;
  const repo = await getNoteRepository();

  const note = await repo.restore(ownerId, req.params.id);
  if (!note) {
    throw ApiError.notFound("Không tìm thấy ghi chú trong thùng rác");
  }
  const tags = await repo.findNoteTags(note.id);

  res.json({
    success: true,
    message: "Đã khôi phục ghi chú",
    data: toSafeNote(note, tags),
  });
}

/** DELETE /notes/trash/:id — xoá HẲN note khỏi thùng rác (luôn xoá note_tags) → 204 */
export async function hardDeleteNote(
  req: Request,
  res: Response,
): Promise<void> {
  const ownerId = req.user!.id;
  const repo = await getNoteRepository();

  const deleted = await repo.hardDelete(ownerId, req.params.id);
  if (!deleted) {
    throw ApiError.notFound("Không tìm thấy ghi chú trong thùng rác");
  }
  res.status(204).send();
}

/** POST /notes/:id/share — bật public share, trả { shareToken, url } */
export async function enableShare(req: Request, res: Response): Promise<void> {
  const ownerId = req.user!.id;
  const repo = await getNoteRepository();

  const token = randomBytes(16).toString("hex");
  const note = await repo.setShareToken(ownerId, req.params.id, token);
  if (!note) {
    throw ApiError.notFound("Không tìm thấy ghi chú");
  }

  const url = `${req.protocol}://${req.get("host")}/api/v1/public/notes/${token}`;
  res.json({
    success: true,
    data: { shareToken: note.shareToken, url },
  });
}

/** DELETE /notes/:id/share — thu hồi public share → { shareToken: null } */
export async function disableShare(req: Request, res: Response): Promise<void> {
  const ownerId = req.user!.id;
  const repo = await getNoteRepository();

  const note = await repo.setShareToken(ownerId, req.params.id, null);
  if (!note) {
    throw ApiError.notFound("Không tìm thấy ghi chú");
  }

  res.json({
    success: true,
    data: { shareToken: note.shareToken },
  });
}
