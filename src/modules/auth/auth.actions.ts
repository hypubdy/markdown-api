import bcrypt from "bcryptjs";
import type { AppContext } from "../../types/hono";
import { env } from "../../config/env";
import { toSafeUser } from "../../data/user.repository";
import { validated } from "../../middleware/validate.middleware";
import type { LoginBody, RegisterBody } from "./auth.schemas";
import { ApiError } from "../../utils/ApiError";
import { signAccessToken } from "../../utils/jwt";

function ensureLocalAuthEnabled(): void {
  if (env.AUTH_PROVIDER === "clerk") {
    throw new ApiError(410, "Đăng nhập/đăng ký bằng mật khẩu đã tắt — hãy đăng nhập bằng Clerk (SSO: Google/GitHub)");
  }
}

export async function register(c: AppContext) {
  ensureLocalAuthEnabled();
  const body = validated<RegisterBody>(c, "body");
  const users = await c.get("services").getUserRepository();
  if (await users.findByEmail(body.email)) throw ApiError.conflict("Email này đã được đăng ký");
  const user = await users.create(body);
  return c.json({ success: true, message: "Đăng ký thành công", data: { token: signAccessToken(user), user: toSafeUser(user) } }, 201);
}

export async function login(c: AppContext) {
  ensureLocalAuthEnabled();
  const { email, password } = validated<LoginBody>(c, "body");
  const users = await c.get("services").getUserRepository();
  const user = await users.findByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw ApiError.unauthorized("Email hoặc mật khẩu không đúng");
  }
  return c.json({ success: true, message: "Đăng nhập thành công", data: { token: signAccessToken(user), user: toSafeUser(user) } });
}


