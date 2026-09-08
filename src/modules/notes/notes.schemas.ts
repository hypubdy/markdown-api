import { z } from "zod";

/**
 * Schema validate PAYLOAD của module notes — đúng hợp đồng API:
 * title 1–200, content ≤ 1MB, status draft|published, tagNames ≤ 20 tag × 1–30 ký tự.
 * Params :id luôn là UUID (sai định dạng → 400).
 */

const idSchema = z.string().uuid("ID không đúng định dạng UUID");

const titleSchema = z
  .string()
  .trim()
  .min(1, "Tiêu đề không được để trống")
  .max(200, "Tiêu đề tối đa 200 ký tự");

const contentSchema = z.string().max(1_000_000, "Nội dung tối đa 1MB");

const statusSchema = z.enum(["draft", "published"], {
  errorMap: () => ({ message: "status phải là 'draft' hoặc 'published'" }),
});

const tagNameSchema = z
  .string()
  .trim()
  .min(1, "Tên tag không được để trống")
  .max(30, "Tên tag tối đa 30 ký tự");

/**
 * tagNames: engine test (case-runner) biến mảng trong body thành object dạng
 * {"0": "...", "1": "..."} trước khi gửi — chuẩn hoá về mảng ở đây.
 * Vẫn chấp nhận mảng JSON chuẩn từ client thật.
 */
const tagNamesSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      return Object.values(value as Record<string, unknown>);
    }
    return value;
  },
  z.array(tagNameSchema).max(20, "Mỗi lần tối đa 20 tag"),
);

/** POST /notes — body bắt buộc có title */
export const createNoteSchema = z.object({
  body: z.object({
    title: titleSchema,
    content: contentSchema.optional(),
    status: statusSchema.optional(),
    tagNames: tagNamesSchema.optional(),
  }),
});
export type CreateNoteBody = z.infer<typeof createNoteSchema.shape.body>;

/** PATCH /notes/:id — mọi trường đều tuỳ chọn */
export const updateNoteSchema = z.object({
  params: z.object({ id: idSchema }),
  body: z.object({
    title: titleSchema.optional(),
    content: contentSchema.optional(),
    status: statusSchema.optional(),
    tagNames: tagNamesSchema.optional(),
  }),
});
export type UpdateNoteBody = z.infer<typeof updateNoteSchema.shape.body>;

/** GET /notes — query lọc + phân trang (page/limit có default qua coerce) */
export const listNotesQuerySchema = z.object({
  query: z.object({
    q: z.string().trim().max(200, "q tối đa 200 ký tự").optional(),
    status: statusSchema.optional(),
    tag: z.string().trim().min(1).max(30, "Tên tag tối đa 30 ký tự").optional(),
    page: z.coerce.number().int().min(1, "page phải ≥ 1").default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1, "limit phải ≥ 1")
      .max(100, "limit tối đa 100")
      .default(10),
  }),
});
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema.shape.query>;

/** GET/PATCH/DELETE /notes/:id — params id là UUID */
export const noteIdParamSchema = z.object({
  params: z.object({ id: idSchema }),
});
