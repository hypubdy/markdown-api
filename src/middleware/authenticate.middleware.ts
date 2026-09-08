import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { verifyAccessToken } from "../utils/jwt";

/**
 * Middleware xác thực: đọc `Authorization: Bearer <token>`,
 * verify JWT rồi gắn thông tin user vào req.user.
 * Các route đặt sau middleware này đều "đã đăng nhập".
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return next(ApiError.unauthorized("Thiếu token — cần header Authorization: Bearer <token>"));
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    next(ApiError.unauthorized("Token không hợp lệ hoặc đã hết hạn"));
  }
}
