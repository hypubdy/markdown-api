import type { AppContext } from "../../types/hono";
import { validated } from "../../middleware/validate.middleware";
import { ApiError } from "../../utils/ApiError";

export async function listTags(c: AppContext) {
  const data = await (await c.get("services").getNoteRepository()).listTagsWithCount(c.get("user")!.id);
  return c.json({ success: true, data });
}

export async function removeTag(c: AppContext) {
  const { name } = validated<{ name: string }>(c, "params");
  const removed = await (await c.get("services").getNoteRepository()).removeTag(c.get("user")!.id, name);
  if (!removed) throw ApiError.notFound("Không tìm thấy tag");
  return c.json({ success: true, message: `Đã xoá tag "${name}"` });
}


