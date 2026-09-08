import { validate } from "../../middleware/validate.middleware";
import type { RouteTable } from "../../utils/router";
import { login, register } from "./auth.actions";
import { loginSchema, registerSchema } from "./auth.schemas";

/**
 * ROUTES của module auth — khai báo dạng OBJECT.
 * createRouter() (trong modules/index.ts) sẽ biến bảng này thành Express Router.
 * Các route này công khai (không cần token).
 * Field `openapi` = tài liệu Swagger gắn ngay trên route (generator đọc để sinh spec).
 */
export const authRoutes: RouteTable = {
  register: {
    method: "post",
    path: "/register",
    middlewares: [validate(registerSchema)],
    action: register,
    openapi: {
      summary: "Đăng ký tài khoản mới",
      schema: registerSchema,
      success: 201,
      data: { $ref: "#/components/schemas/AuthResult" },
      errorDescriptions: { "409": "Email đã được đăng ký" },
    },
  },
  login: {
    method: "post",
    path: "/login",
    middlewares: [validate(loginSchema)],
    action: login,
    openapi: {
      summary: "Đăng nhập — trả về JWT",
      schema: loginSchema,
      data: { $ref: "#/components/schemas/AuthResult" },
    },
  },
};
