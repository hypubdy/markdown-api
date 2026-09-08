import type { Request, Response } from "express";
import { getNoteRepository } from "../../data/index";
import { ApiError } from "../../utils/ApiError";

/**
 * ACTIONS của module tags — mọi tag đều theo ownerId = req.user.id
 * (authenticate cấp module). Tag của user khác hoàn toàn không nhìn thấy.
 */

/** GET /tags — tags của mình kèm count note SỐNG đang mang (chỉ tag có ≥ 1 note sống) */
export async function listTags(req: Request, res: Response): Promise<void> {
  const repo = await getNoteRepository();
  const data = await repo.listTagsWithCount(req.user!.id);
  res.json({ success: true, data });
}

/** DELETE /tags/:name — xoá tag (theo ownerId + name); link note_tags tự xoá qua CASCADE */
export async function removeTag(req: Request, res: Response): Promise<void> {
  const repo = await getNoteRepository();
  const removed = await repo.removeTag(req.user!.id, req.params.name);
  if (!removed) {
    throw ApiError.notFound("Không tìm thấy tag");
  }
  res.json({ success: true, message: `Đã xoá tag "${req.params.name}"` });
}
