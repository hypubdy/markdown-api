import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../types/index";
import { ApiError } from "../utils/ApiError";

/**
 * Middleware phân quyền (chạy SAU authenticate):
 * chỉ cho phép user có role nằm trong danh sách truyền vào.
 * Ví dụ: authorize("admin")
 */
export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return next(ApiError.unauthorized("Chưa xác thực"));
    }

    if (!roles.includes(user.role)) {
      return next(
        ApiError.forbidden(`Cần quyền ${roles.join(" hoặc ")} để thực hiện thao tác này`),
      );
    }

    next();
  };
}
