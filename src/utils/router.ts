import { Hono, type Handler, type MiddlewareHandler } from "hono";
import type { ZodTypeAny } from "zod";
import type { AppEnv } from "../types/hono";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RouteOpenApi {
  summary?: string;
  description?: string;
  schema?: ZodTypeAny;
  success?: number;
  data?: Record<string, unknown>;
  errorDescriptions?: Record<string, string>;
}

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  middlewares?: MiddlewareHandler<AppEnv>[];
  action: Handler<AppEnv>;
  openapi?: RouteOpenApi;
}

export type RouteTable = Record<string, RouteDefinition>;

/** Biến bảng route dạng object thành Hono router, giữ nguyên thứ tự khai báo. */
export function createRouter(
  table: RouteTable,
  options: { middlewares?: MiddlewareHandler<AppEnv>[] } = {},
): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  if (options.middlewares?.length) {
    router.use("*", ...options.middlewares);
  }

  for (const route of Object.values(table)) {
    const handlers = [...(route.middlewares ?? []), route.action] as unknown as [
      MiddlewareHandler<AppEnv> | Handler<AppEnv>,
      ...(MiddlewareHandler<AppEnv> | Handler<AppEnv>)[],
    ];
    router.on(route.method.toUpperCase(), route.path, ...handlers);
  }

  return router;
}
