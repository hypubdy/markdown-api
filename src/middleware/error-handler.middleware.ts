import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../types/hono";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";

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

  // Lỗi ngoài dự kiến: log kèm requestId để nối với các dòng log khác của cùng request.
  logger.error(`Lỗi không xác định: ${err.message}`, {
    requestId: c.get("requestId"),
    stack: err.stack?.split("\n").slice(1, 4).map((line) => line.trim()).join(" ← "),
  });

  const production = c.env?.NODE_ENV === "production" || process.env.NODE_ENV === "production";
  return c.json(
    { success: false, message: production ? "Lỗi máy chủ nội bộ" : err.message },
    500,
  );
};
