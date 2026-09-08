import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { getUserRepository } from "../../data/index";
import { toSafeUser } from "../../data/user.repository";
import type { LoginBody, RegisterBody } from "./auth.schemas";
import { ApiError } from "../../utils/ApiError";
import { signAccessToken } from "../../utils/jwt";

/**
 * ACTIONS của module auth — logic thuần, không biết gì về express Router.
 * Truy xuất dữ liệu qua UserRepository (interface chung — SQLite khi test,
 * PostgreSQL khi chạy thật). Khai báo async: lỗi ném ra được createRouter()
 * bọc asyncHandler và đẩy về error-handler chung.
 */

/** POST /auth/register — đăng ký tài khoản mới */
export async function register(req: Request, res: Response): Promise<void> {
  const body = req.body as RegisterBody;
  const users = await getUserRepository();

  const existing = await users.findByEmail(body.email);
  if (existing) {
    throw ApiError.conflict("Email này đã được đăng ký");
  }

  const user = await users.create(body);
  const token = signAccessToken(user);

  res.status(201).json({
    success: true,
    message: "Đăng ký thành công",
    data: { token, user: toSafeUser(user) },
  });
}

/** POST /auth/login — đăng nhập, trả về JWT */
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginBody;
  const users = await getUserRepository();

  const user = await users.findByEmail(email);
  if (!user) {
    // Không tiết lộ user có tồn tại hay không
    throw ApiError.unauthorized("Email hoặc mật khẩu không đúng");
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw ApiError.unauthorized("Email hoặc mật khẩu không đúng");
  }

  const token = signAccessToken(user);

  res.json({
    success: true,
    message: "Đăng nhập thành công",
    data: { token, user: toSafeUser(user) },
  });
}
