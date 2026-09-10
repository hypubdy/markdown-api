import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../types/hono";
import { ApiError } from "../utils/ApiError";

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      {
        success: false,
        message: err.message,
        ...(err.details !== undefined && { details: err.details }),
      },
      err.statusCode as ContentfulStatusCode,
    );
  }

  console.error(`[${new Date().toISOString()}] Lỗi không xác định:`, err);
  const production = c.env?.NODE_ENV === "production" || process.env.NODE_ENV === "production";
  return c.json(
    { success: false, message: production ? "Lỗi máy chủ nội bộ" : err.message },
    500,
  );
};
