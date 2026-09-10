import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types/hono";
import type { UserRole } from "../types/index";
import { ApiError } from "../utils/ApiError";

export function authorize(...roles: UserRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) throw ApiError.unauthorized("Chưa xác thực");
    if (!roles.includes(user.role)) {
      throw ApiError.forbidden(`Cần quyền ${roles.join(" hoặc ")} để thực hiện thao tác này`);
    }
    await next();
  };
}
