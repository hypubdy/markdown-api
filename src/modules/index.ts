import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/authenticate.middleware";
import { createRouter, type RouteTable } from "../utils/router";
import type { MountGroup } from "../swagger/build";
import { authRoutes } from "./auth/auth.routes";
import { notesRoutes } from "./notes/notes.routes";
import { publicRoutes } from "./public/public.routes";
import { tagsRoutes } from "./tags/tags.routes";
import { userRoutes } from "./user/user.routes";

/**
 * Router gốc /api/v1 — nơi ráp các MODULE lại với nhau.
 *
 * Cách thêm module mới:
 *   1. tạo thư mục modules/<tên>/ chứa <tên>.actions.ts + <tên>.routes.ts
 *      (route có field `openapi` để sinh Swagger tự động)
 *   2. thêm 1 mục vào `apiMountGroups` bên dưới — tự mount router + tự xuất hiện trên Swagger.
 */

/** Health — endpoint hệ thống (action nhỏ, đặt ngay đây) */
const healthAction = async (_req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    data: {
      status: "ok",
      uptime: `${Math.round(process.uptime())}s`,
      timestamp: new Date().toISOString(),
    },
  });
};

export const healthRoutes: RouteTable = {
  check: {
    method: "get",
    path: "/health",
    action: healthAction,
    openapi: { summary: "Kiểm tra server còn sống" },
  },
};

/**
 * DANH SÁCH NHÓM MOUNT — nguồn duy nhất cho:
 * - mount router (vòng lặp bên dưới), và
 * - generator OpenAPI (src/swagger/build.ts) đọc để sinh spec Swagger.
 */
export const apiMountGroups: MountGroup[] = [
  { prefix: "", table: healthRoutes, authenticated: false, tag: "System" },
  { prefix: "/auth", table: authRoutes, authenticated: false, tag: "Auth" },
  { prefix: "/users", table: userRoutes, authenticated: true, tag: "Users" },
  { prefix: "/notes", table: notesRoutes, authenticated: true, tag: "Notes" },
  { prefix: "/tags", table: tagsRoutes, authenticated: true, tag: "Tags" },
  { prefix: "/public", table: publicRoutes, authenticated: false, tag: "Public" },
];

export const apiRouter = Router();

for (const group of apiMountGroups) {
  const router = createRouter(group.table, {
    middlewares: group.authenticated ? [authenticate] : [],
  });
  // prefix "" (health) mount tại gốc; nhóm khác mount tại prefix của nó
  apiRouter.use(group.prefix === "" ? "/" : group.prefix, router);
}
