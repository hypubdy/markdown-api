import { authorize } from "../../middleware/authorize.middleware";
import { validate } from "../../middleware/validate.middleware";
import type { RouteTable } from "../../utils/router";
import {
  deleteUser,
  getMe,
  getStats,
  getUserById,
  getUserProfile,
  listUsers,
  updateRole,
} from "./user.actions";
import {
  idParamSchema,
  listUsersQuerySchema,
  updateRoleSchema,
} from "./user.schemas";

/**
 * ROUTES của module user — khai báo dạng OBJECT.
 * Toàn bộ route module này đều cần đăng nhập:
 * middleware authenticate được gắn ở cấp module (xem modules/index.ts).
 *
 * Lưu ý thứ tự: "stats", "me" phải đứng trước ":id" để không bị ":id" nuốt mất.
 */
export const userRoutes: RouteTable = {
  listUsers: {
    method: "get",
    path: "/",
    middlewares: [validate(listUsersQuerySchema)],
    action: listUsers,
  },
  getStats: {
    method: "get",
    path: "/stats",
    middlewares: [authorize("admin")],
    action: getStats,
  },
  getMe: {
    method: "get",
    path: "/me",
    action: getMe,
  },
  getUserById: {
    method: "get",
    path: "/:id",
    middlewares: [validate(idParamSchema)],
    action: getUserById,
  },
  getUserProfile: {
    method: "get",
    path: "/:id/profile",
    middlewares: [validate(idParamSchema)],
    action: getUserProfile,
  },
  updateRole: {
    method: "patch",
    path: "/:id/role",
    middlewares: [validate(updateRoleSchema), authorize("admin")],
    action: updateRole,
  },
  deleteUser: {
    method: "delete",
    path: "/:id",
    middlewares: [validate(idParamSchema), authorize("admin")],
    action: deleteUser,
  },
};
