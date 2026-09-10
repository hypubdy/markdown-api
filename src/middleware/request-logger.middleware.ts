import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types/hono";

export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const startedAt = Date.now();
  await next();
  console.log(
    `[${new Date().toISOString()}] ${c.req.method} ${c.req.path} → ${c.res.status} (${Date.now() - startedAt}ms)`,
  );
};
