import { z } from "zod";

/**
 * Schema validate PAYLOAD của request trong module auth.
 * Chỉ dùng cho middleware validate() ở các route của module này.
 */
const nameSchema = z
  .string()
  .trim()
  .min(2, "Tên phải có ít nhất 2 ký tự")
  .max(100, "Tên tối đa 100 ký tự");

const emailSchema = z.string().trim().email("Email không hợp lệ");

const passwordSchema = z
  .string()
  .min(6, "Mật khẩu phải có ít nhất 6 ký tự")
  .max(72, "Mật khẩu tối đa 72 ký tự");

export const registerSchema = z.object({
  body: z.object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
  }),
});
export type RegisterBody = z.infer<typeof registerSchema.shape.body>;

export const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: passwordSchema,
  }),
});
export type LoginBody = z.infer<typeof loginSchema.shape.body>;
