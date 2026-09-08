import { validate } from "../../middleware/validate.middleware";
import type { RouteTable } from "../../utils/router";
import { login, register } from "./auth.actions";
import { loginSchema, registerSchema } from "./auth.schemas";

/**
 * ROUTES của module auth — khai báo dạng OBJECT.
 * createRouter() (trong modules/index.ts) sẽ biến bảng này thành Express Router.
 * Các route này công khai (không cần token).
 */
export const authRoutes: RouteTable = {
  register: {
    method: "post",
    path: "/register",
    middlewares: [validate(registerSchema)],
    action: register,
  },
  login: {
    method: "post",
    path: "/login",
    middlewares: [validate(loginSchema)],
    action: login,
  },
};
