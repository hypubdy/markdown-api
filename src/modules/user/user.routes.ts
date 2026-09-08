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
    openapi: {
      summary: "Danh sách user (lọc ?role= / ?q=)",
      schema: listUsersQuerySchema,
      data: { $ref: "#/components/schemas/UserList" },
    },
  },
  getStats: {
    method: "get",
    path: "/stats",
    middlewares: [authorize("admin")],
    action: getStats,
    openapi: {
      summary: "Thống kê số lượng user (admin)",
      data: { $ref: "#/components/schemas/UserStats" },
      errorDescriptions: { "403": "Cần quyền admin" },
    },
  },
  getMe: {
    method: "get",
    path: "/me",
    action: getMe,
    openapi: {
      summary: "Thông tin user hiện tại (từ token)",
      data: { $ref: "#/components/schemas/User" },
    },
  },
  getUserById: {
    method: "get",
    path: "/:id",
    middlewares: [validate(idParamSchema)],
    action: getUserById,
    openapi: {
      summary: "Chi tiết user theo id",
      schema: idParamSchema,
      data: { $ref: "#/components/schemas/User" },
    },
  },
  getUserProfile: {
    method: "get",
    path: "/:id/profile",
    middlewares: [validate(idParamSchema)],
    action: getUserProfile,
    openapi: {
      summary: "Hồ sơ công khai gọn nhẹ (không lộ email)",
      schema: idParamSchema,
      data: { $ref: "#/components/schemas/UserProfile" },
    },
  },
  updateRole: {
    method: "patch",
    path: "/:id/role",
    middlewares: [validate(updateRoleSchema), authorize("admin")],
    action: updateRole,
    openapi: {
      summary: "Đổi role user (admin)",
      schema: updateRoleSchema,
      data: { $ref: "#/components/schemas/User" },
      errorDescriptions: { "403": "Cần quyền admin" },
    },
  },
  deleteUser: {
    method: "delete",
    path: "/:id",
    middlewares: [validate(idParamSchema), authorize("admin")],
    action: deleteUser,
    openapi: {
      summary: "Xoá user (admin; không xoá chính mình)",
      schema: idParamSchema,
      success: 204,
      errorDescriptions: { "403": "Cần quyền admin" },
    },
  },
};
