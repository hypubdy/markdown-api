/**
 * ĐO + LOG QUERY DB — bọc quanh repository để biết mỗi request đã gọi DB bao nhiêu
 * lần, mất bao lâu, query nào chậm.
 *
 * Cách làm: KHÔNG sửa từng repository (có 3 driver: sqlite/supabase/worker) mà dùng
 * `Proxy` bọc lấy instance repository. Nhờ vậy mọi driver đều được log giống nhau,
 * và tầng action/handler không phải đổi gì.
 *
 * Ai gọi: middleware `requestLogger` (src/middleware/request-logger.middleware.ts) —
 * mỗi request tạo 1 `QueryStats`, bọc `services`, rồi in tổng kết khi request xong.
 */

import { isQueryLogEnabled, logger, loggerConfig } from "./logger";

export interface QueryStats {
  /** Id request để mọi dòng log của cùng request nối được với nhau. */
  requestId?: string;
  /** Tổng số query đã chạy trong request này. */
  count: number;
  /** Tổng thời gian nằm trong DB (ms). */
  totalMs: number;
  /** Số query vượt ngưỡng SLOW_QUERY_MS. */
  slow: number;
  /** Số query ném lỗi. */
  failed: number;
  /** Thống kê theo từng repository: "users" / "notes". */
  byTarget: Map<string, { count: number; ms: number }>;
}

export function createQueryStats(requestId?: string): QueryStats {
  return {
    requestId,
    count: 0,
    totalMs: 0,
    slow: 0,
    failed: 0,
    byTarget: new Map(),
  };
}

const SECRET_KEY = /pass(word)?|secret|token|authorization|apikey|api_key|jwt/i;

/** Che các trường nhạy cảm trước khi ghi ra log. */
function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? "[đã che]" : redact(item, depth + 1);
  }
  return out;
}

/** Mô tả ngắn tham số của 1 lời gọi repo (chỉ dùng khi LOG_QUERY_ARGS=true). */
export function summarizeQueryArgs(args: unknown[], maxLength = 160): string {
  try {
    const text = JSON.stringify(redact(args));
    if (text === undefined) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  } catch {
    return "[không serialize được]";
  }
}

/**
 * Bọc repository: mọi method async được đo thời gian, ghi log và cộng vào `stats`.
 * `target` là nhãn hiển thị ("users" | "notes").
 */
export function instrumentRepository<T extends object>(
  repo: T,
  target: string,
  stats: QueryStats,
): T {
  return new Proxy(repo, {
    get(obj, property) {
      const value = Reflect.get(obj, property, obj) as unknown;
      if (typeof value !== "function") return value;

      const method = String(property);

      return function instrumented(this: unknown, ...args: unknown[]) {
        const startedAt = performance.now();
        const config = loggerConfig();

        const record = (ok: boolean): void => {
          const durationMs = performance.now() - startedAt;
          stats.count += 1;
          stats.totalMs += durationMs;
          if (!ok) stats.failed += 1;

          const bucket = stats.byTarget.get(target) ?? { count: 0, ms: 0 };
          bucket.count += 1;
          bucket.ms += durationMs;
          stats.byTarget.set(target, bucket);

          const fields: Record<string, unknown> = {
            requestId: stats.requestId,
            target,
            method,
            ms: Math.round(durationMs * 100) / 100,
          };
          if (config.queryArgs) fields.args = summarizeQueryArgs(args);

          if (!ok) {
            logger.error(`query ${target}.${method} LỖI sau ${fields.ms}ms`, fields);
            return;
          }
          if (durationMs >= config.slowQueryMs) {
            stats.slow += 1;
            logger.warn(
              `query CHẬM ${target}.${method} ${fields.ms}ms (ngưỡng ${config.slowQueryMs}ms)`,
              fields,
            );
            return;
          }
          if (config.queries && isQueryLogEnabled()) {
            logger.debug(`query ${target}.${method} ${fields.ms}ms`, fields);
          }
        };

        let result: unknown;
        try {
          result = (value as (...a: unknown[]) => unknown).apply(obj, args);
        } catch (error) {
          record(false);
          throw error;
        }

        if (result !== null && typeof (result as PromiseLike<unknown>)?.then === "function") {
          return (result as Promise<unknown>).then(
            (resolved) => {
              record(true);
              return resolved;
            },
            (error) => {
              record(false);
              throw error;
            },
          );
        }

        record(true);
        return result;
      };
    },
  });
}
