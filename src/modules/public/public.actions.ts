import type { Request, Response } from "express";
import { getNoteRepository } from "../../data/index";
import { ApiError } from "../../utils/ApiError";

/**
 * ACTIONS của module public — KHÔNG yêu cầu đăng nhập (mount riêng, ngoài authenticate).
 * Token lạ / đã thu hồi / note đã soft-delete → 404 như thể không tồn tại.
 */

/** GET /public/notes/:shareToken — xem note được chia sẻ công khai */
export async function getPublicNote(
  req: Request,
  res: Response,
): Promise<void> {
  const repo = await getNoteRepository();

  const note = await repo.findByShareToken(req.params.shareToken);
  if (!note) {
    throw ApiError.notFound(
      "Liên kết chia sẻ không tồn tại hoặc đã bị thu hồi",
    );
  }

  res.json({
    success: true,
    data: {
      id: note.id,
      title: note.title,
      content: note.content,
      updatedAt: note.updatedAt,
    },
  });
}
