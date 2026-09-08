import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../src/config/env";
import type { AuthUser } from "../../src/types/index";

/**
 * HELPER DÙNG CHUNG CHO CÁC FILE TEST (không phải file test).
 */

/**
 * "Ký giả" một token phiên đã đăng nhập bằng ĐÚNG JWT_SECRET của app
 * (không cần gọi login/register). Token vẫn qua jwt.verify() của middleware
 * authenticate thật — tự chọn id/email/role tuỳ ý.
 */
export function signInAs(overrides: Partial<AuthUser> = {}): string {
  const payload: AuthUser = {
    id: randomUUID(),
    email: "fake-login@example.com",
    role: "user",
    ...overrides,
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "15m" });
}

/** Header Authorization "Bearer <token>" chuẩn cho supertest */
export const authBearer = (token: string) => ({
  Authorization: `Bearer ${token}`,
});
