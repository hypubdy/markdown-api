import cors from "cors";
import express from "express";
import helmet from "helmet";
import { errorHandler } from "./middleware/error-handler.middleware";
import { notFoundHandler } from "./middleware/not-found.middleware";
import { requestLogger } from "./middleware/request-logger.middleware";
import { apiRouter } from "./modules/index";

/**
 * Ráp toàn bộ ứng dụng Express.
 * Thứ tự đăng ký QUAN TRỌNG: middleware toàn cục → routes → 404 → error-handler (cuối cùng).
 */
export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // ── Middleware toàn cục ───────────────────────────────
  app.use(helmet()); // bảo mật HTTP headers
  app.use(cors()); // tuỳ chỉnh origin theo domain khi lên production
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  // ── Routes ────────────────────────────────────────────
  app.use("/api/v1", apiRouter);

  // ── Xử lý 404 và lỗi (LUÔN đặt sau routes) ────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
