import { z } from "zod";

/**
 * Schema validate PAYLOAD của request trong module user.
 * Chỉ dùng cho middleware validate() ở các route của module này.
 */
const paramIdSchema = z.string().uuid("ID không đúng định dạng UUID");

/** Validate query của GET /users: lọc theo role và/hoặc từ khoá tìm tên/email */
export const listUsersQuerySchema = z.object({
  query: z.object({
    role: z
      .enum(["admin", "user"], {
        errorMap: () => ({ message: "role phải là 'admin' hoặc 'user'" }),
      })
      .optional(),
    q: z
      .string()
      .trim()
      .max(100, "q tối đa 100 ký tự")
      .optional(),
  }),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema.shape.query>;

/** Validate riêng params :id */
export const idParamSchema = z.object({
  params: z.object({ id: paramIdSchema }),
});

/** Validate cả params :id lẫn body khi đổi role */
export const updateRoleSchema = z.object({
  params: z.object({ id: paramIdSchema }),
  body: z.object({
    role: z.enum(["admin", "user"], {
      errorMap: () => ({ message: "Role phải là 'admin' hoặc 'user'" }),
    }),
  }),
});
export type UpdateRoleBody = z.infer<typeof updateRoleSchema.shape.body>;
