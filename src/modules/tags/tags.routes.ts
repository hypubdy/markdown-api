import { z } from "zod";
import { validate } from "../../middleware/validate.middleware";
import type { RouteTable } from "../../utils/router";
import { listTags, removeTag } from "./tags.actions";

/** DELETE /tags/:name — tên tag hợp lệ 1–30 ký tự (sau khi trim) */
const tagNameParamSchema = z.object({
  params: z.object({
    name: z
      .string()
      .trim()
      .min(1, "Tên tag không được để trống")
      .max(30, "Tên tag tối đa 30 ký tự"),
  }),
});

/**
 * ROUTES của module tags — khai báo dạng OBJECT.
 * Toàn bộ route module này đều cần đăng nhập: authenticate gắn ở cấp module.
 * Field `openapi` = tài liệu Swagger gắn ngay trên route.
 */
export const tagsRoutes: RouteTable = {
  listTags: {
    method: "get",
    path: "/",
    action: listTags,
    openapi: {
      summary: "Tags của mình kèm count (chỉ note đang sống)",
      data: { $ref: "#/components/schemas/TagList" },
    },
  },
  removeTag: {
    method: "delete",
    path: "/:name",
    middlewares: [validate(tagNameParamSchema)],
    action: removeTag,
    openapi: {
      summary: "Xoá tag (không của mình/không tồn tại → 404)",
      schema: tagNameParamSchema,
      errorDescriptions: { "404": "Không tìm thấy tag thuộc về bạn" },
    },
  },
};
