import type { MiddlewareHandler } from "hono";
import type { AppEnv, RuntimeServices } from "../types/hono";
import { ApiError } from "../utils/ApiError";
import { logger, loggerConfig } from "../utils/logger";
import {
  createQueryStats,
  instrumentRepository,
  type QueryStats,
} from "../utils/query-logger";

/**
 * MIDDLEWARE LOG — một chỗ duy nhất lo toàn bộ việc log của 1 request:
 *
 *   1. Sinh `requestId` → mọi dòng log của request này đều có tiền tố [req xxxxxxxx].
 *   2. Bọc `services` bằng `Proxy` (xem src/utils/query-logger.ts) để MỌI query DB
 *      phát sinh trong request được log kèm thời gian và cộng dồn vào `QueryStats`.
 *      ⇒ Không phải sửa repository/handler nào, và cả 3 driver (sqlite/supabase/worker)
 *      đều được log như nhau.
 *   3. In tổng kết cuối request: status, tổng thời gian, số query, tổng thời gian DB.
 *      Request/query vượt ngưỡng bị nâng lên mức WARN để dễ soi.
 *
 * Kết quả log (dev, LOG_LEVEL=debug):
 *   ... DEBUG [req 3f2a1b0c] → GET /api/v1/notes
 *   ... DEBUG [req 3f2a1b0c] query notes.list 246.31ms target=notes method=list ms=246.31
 *   ... DEBUG [req 3f2a1b0c] query notes.findNoteTags 82.4ms  target=notes method=findNoteTags ms=82.4
 *   ... INFO  [req 3f2a1b0c] GET /api/v1/notes 200 331ms queries=2 dbMs=328.71
 *
 * Xem cấu hình ở src/utils/logger.ts (LOG_LEVEL / LOG_QUERIES / SLOW_QUERY_MS / ...).
 */

type UserRepo = Awaited<ReturnType<RuntimeServices["getUserRepository"]>>;
type NoteRepo = Awaited<ReturnType<RuntimeServices["getNoteRepository"]>>;

/** Tạo id ngắn, dễ đọc, để nối các dòng log của cùng một request. */
function newRequestId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(16).slice(2, 10);
}

/**
 * Trả về `services` đã bọc đo-query. Repository gốc vẫn là singleton dùng chung,
 * chỉ lớp Proxy là mới cho mỗi request (rất nhẹ) — nhờ đó số liệu không lẫn giữa
 * các request chạy song song.
 */
function scopeServices(services: RuntimeServices, stats: QueryStats): RuntimeServices {
  let users: UserRepo | undefined;
  let notes: NoteRepo | undefined;

  return {
    async getUserRepository(): Promise<UserRepo> {
      users ??= instrumentRepository(await services.getUserRepository(), "users", stats);
      return users;
    },
    async getNoteRepository(): Promise<NoteRepo> {
      notes ??= instrumentRepository(await services.getNoteRepository(), "notes", stats);
      return notes;
    },
  };
}

export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = newRequestId();
  const stats = createQueryStats(requestId);
  const startedAt = performance.now();

  const method = c.req.method;
  const path = c.req.path;

  c.set("requestId", requestId);

  const services = c.get("services");
  if (services) c.set("services", scopeServices(services, stats));

  logger.debug(`→ ${method} ${path}`, { requestId });

  let thrown: unknown;
  try {
    await next();
  } catch (error) {
    // Hono bắt lỗi của handler, gán vào `c.error` rồi gọi onError → `next()` KHÔNG ném ra.
    // Nhánh này chỉ chạy khi lỗi phát sinh ngoài luồng đó (vd chính onError cũng lỗi).
    thrown = error;
    throw error;
  } finally {
    const durationMs = performance.now() - startedAt;
    const ms = Math.round(durationMs * 100) / 100;
    const config = loggerConfig();

    // Hono bắt lỗi của handler, gán vào `c.error` rồi gọi onError → `next()` KHÔNG ném ra.
    // `thrown` chỉ có giá trị khi lỗi phát sinh ngoài luồng đó (vd chính onError cũng lỗi).
    const failure = c.error ?? thrown;
    const status =
      thrown instanceof ApiError
        ? thrown.statusCode
        : thrown
          ? 500
          : (c.res?.status ?? 0);

    const fields = {
      requestId,
      // Bản pretty đã có method/path/status/ms ngay trong message → chỉ thêm khi log JSON.
      ...(config.json && { method, path, status, ms }),
      queries: stats.count,
      dbMs: Math.round(stats.totalMs * 100) / 100,
      ...(stats.slow > 0 && { slowQueries: stats.slow }),
      ...(stats.failed > 0 && { failedQueries: stats.failed }),
      ...(failure instanceof Error && { error: failure.message }),
    };

    logger[status >= 500 ? "error" : "info"](`${method} ${path} ${status} ${ms}ms`, fields);

    if (durationMs >= config.slowRequestMs && status < 500) {
      logger.warn(
        `request CHẬM ${method} ${path} ${ms}ms (ngưỡng ${config.slowRequestMs}ms)`,
        fields,
      );
    }
  }
};
