import type { AppContext } from "../../types/hono";
import { validated } from "../../middleware/validate.middleware";
import { ApiError } from "../../utils/ApiError";

export async function getPublicNote(c: AppContext) {
  const { shareToken } = validated<{ shareToken: string }>(c, "params");
  const note = await (await c.get("services").getNoteRepository()).findByShareToken(shareToken);
  if (!note) {
    throw ApiError.notFound("Liên kết chia sẻ không tồn tại hoặc đã bị thu hồi");
  }
  return c.json({
    success: true,
    data: {
      id: note.id,
      title: note.title,
      content: note.content,
      updatedAt: note.updatedAt,
    },
  });
}


