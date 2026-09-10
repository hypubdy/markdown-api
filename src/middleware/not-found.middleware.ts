import type { NotFoundHandler } from "hono";
import type { AppEnv } from "../types/hono";

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json(
    {
      success: false,
      message: `Không tìm thấy route: ${c.req.method} ${c.req.path}`,
    },
    404,
  );
