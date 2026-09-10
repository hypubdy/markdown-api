import { Hono } from "hono";
import type { AppEnv } from "../types/hono";
import { authenticate } from "../middleware/authenticate.middleware";
import { createRouter, type RouteTable } from "../utils/router";
import type { MountGroup } from "../swagger/build";
import { authRoutes } from "./auth/auth.routes";
import { notesRoutes } from "./notes/notes.routes";
import { publicRoutes } from "./public/public.routes";
import { tagsRoutes } from "./tags/tags.routes";
import { userRoutes } from "./user/user.routes";

const startedAt = Date.now();
export const healthRoutes: RouteTable = {
  check: {
    method: "get",
    path: "/health",
    action: async (c) => c.json({ success: true, data: {
      status: "ok",
      uptime: `${Math.round((Date.now() - startedAt) / 1000)}s`,
      timestamp: new Date().toISOString(),
    }}),
    openapi: { summary: "Kiểm tra server còn sống" },
  },
};

export const apiMountGroups: MountGroup[] = [
  { prefix: "", table: healthRoutes, authenticated: false, tag: "System" },
  { prefix: "/auth", table: authRoutes, authenticated: false, tag: "Auth" },
  { prefix: "/users", table: userRoutes, authenticated: true, tag: "Users" },
  { prefix: "/notes", table: notesRoutes, authenticated: true, tag: "Notes" },
  { prefix: "/tags", table: tagsRoutes, authenticated: true, tag: "Tags" },
  { prefix: "/public", table: publicRoutes, authenticated: false, tag: "Public" },
];

export const apiRouter = new Hono<AppEnv>();
for (const group of apiMountGroups) {
  const router = createRouter(group.table, { middlewares: group.authenticated ? [authenticate] : [] });
  apiRouter.route(group.prefix || "/", router);
}
