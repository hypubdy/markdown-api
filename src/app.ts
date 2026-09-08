import cors from "cors";
import express from "express";
import helmet from "helmet";
import { errorHandler } from "./middleware/error-handler.middleware";
import { notFoundHandler } from "./middleware/not-found.middleware";
import { requestLogger } from "./middleware/request-logger.middleware";
import { apiMountGroups, apiRouter } from "./modules/index";
import { buildOpenApiDocument, mountSwagger } from "./swagger/build";

/**
 * Spec OpenAPI được SINH TỰ ĐỘNG từ các bảng route (field openapi trong
 * từng *.routes.ts) — không còn file spec khai báo tay.
 */
const openapiDocument = buildOpenApiDocument({
  info: {
    title: "Express TS — API lưu trữ Markdown",
    version: "1.0.0",
    description:
      "REST API: auth (JWT) · user · notes markdown (CRUD, tìm kiếm, soft-delete/thùng rác, share public) · tags. Spec được sinh tự động từ các file *.routes.ts — bấm Authorize để dán token `Bearer <token>`.",
  },
  groups: apiMountGroups,
});

/**
 * Ráp toàn bộ ứng dụng Express.
 * Thứ tự đăng ký QUAN TRỌNG: middleware toàn cục → routes → swagger → 404 → error-handler (cuối cùng).
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

  // ── Swagger UI + spec JSON (sinh từ route table) ──────
  mountSwagger(app, openapiDocument);

  // ── Xử lý 404 và lỗi (LUÔN đặt sau routes) ────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
