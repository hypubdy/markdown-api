/**
 * LOGGER GỌN DÙNG CHUNG — mỗi sự kiện 1 dòng, có timestamp + level + requestId.
 *
 * Vì sao tự viết thay vì pino/winston: app còn chạy trên Cloudflare Worker nên cần
 * 0 dependency ngoài, chỉ dùng `console`/`process` — chạy được ở mọi runtime.
 *
 * Cấu hình bằng env. Đọc MỘT LẦN rồi cache (không đi qua proxy `env` trong
 * src/config/env.ts vì proxy đó parse lại toàn bộ process.env mỗi lần đọc — xem
 * docs/performance-report.md mục 4):
 *
 *   LOG_LEVEL        debug | info | warn | error | silent  (dev=debug, prod=info, test=warn)
 *   LOG_QUERIES      true|false  in từng query DB          (dev=true, prod/test=false)
 *   LOG_QUERY_ARGS   true|false  in thêm tham số query      (mặc định false)
 *   SLOW_QUERY_MS    ngưỡng cảnh báo 1 query                (mặc định 50)
 *   SLOW_REQUEST_MS  ngưỡng cảnh báo 1 request              (mặc định 500)
 *   LOG_JSON         true|false  log JSON 1 dòng            (mặc định: prod=true)
 *   LOG_COLOR        true|false  tô màu khi ghi ra TTY      (mặc định true)
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const LABEL: Record<Exclude<LogLevel, "silent">, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

const ANSI: Record<Exclude<LogLevel, "silent">, string> = {
  debug: "\x1b[90m", // xám
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // vàng
  error: "\x1b[31m", // đỏ
};
const RESET = "\x1b[0m";

export interface LogFields {
  requestId?: string;
  [key: string]: unknown;
}

export interface LoggerConfig {
  level: LogLevel;
  /** In 1 dòng cho mỗi query DB (mức debug). */
  queries: boolean;
  /** In kèm tham số của query (đã che password/token). */
  queryArgs: boolean;
  slowQueryMs: number;
  slowRequestMs: number;
  json: boolean;
  color: boolean;
}

let cached: LoggerConfig | undefined;

function envOf(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env
    ? (process.env as Record<string, string | undefined>)
    : {};
}

function readBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function readMs(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readLevel(raw: string | undefined): LogLevel | undefined {
  const value = raw?.trim().toLowerCase();
  return value && value in RANK ? (value as LogLevel) : undefined;
}

/** Đọc cấu hình log (cache lần đầu). */
export function loggerConfig(): LoggerConfig {
  if (cached) return cached;

  const env = envOf();
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProd = nodeEnv === "production";
  const isTest = nodeEnv === "test";

  const level =
    readLevel(env.LOG_LEVEL) ?? (isTest ? "warn" : isProd ? "info" : "debug");

  const isTty =
    typeof process !== "undefined" &&
    typeof process.stdout === "object" &&
    process.stdout !== null &&
    process.stdout.isTTY === true;

  cached = {
    level,
    queries: readBool(env.LOG_QUERIES, !isProd && !isTest),
    queryArgs: readBool(env.LOG_QUERY_ARGS, false),
    slowQueryMs: readMs(env.SLOW_QUERY_MS, 50),
    slowRequestMs: readMs(env.SLOW_REQUEST_MS, 500),
    json: readBool(env.LOG_JSON, isProd),
    color: isTty && readBool(env.LOG_COLOR, true),
  };
  return cached;
}

/** Xoá cache cấu hình — dùng cho test khi đổi process.env giữa chừng. */
export function resetLoggerConfig(): void {
  cached = undefined;
}

export function isLevelEnabled(level: Exclude<LogLevel, "silent">): boolean {
  return RANK[level] >= RANK[loggerConfig().level];
}

export function isQueryLogEnabled(): boolean {
  return loggerConfig().queries;
}

/** Giá trị đủ ngắn để nhét vào 1 dòng log. */
function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.includes(" ") ? JSON.stringify(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return "[không serialize được]";
  }
}

/**
 * Ghi 1 dòng log. `fields.requestId` được tách ra thành tiền tố `[req xxxxxxxx]`
 * để mọi dòng của cùng một request nằm cạnh nhau khi đọc log.
 */
export function log(
  level: Exclude<LogLevel, "silent">,
  message: string,
  fields: LogFields = {},
): void {
  const config = loggerConfig();
  if (RANK[level] < RANK[config.level]) return;

  const { requestId, ...rest } = fields;

  if (config.json) {
    const payload: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...(requestId !== undefined && { requestId }),
    };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) payload[key] = value;
    }
    console.log(JSON.stringify(payload));
    return;
  }

  const scope = requestId ? ` [req ${requestId}]` : "";
  const extra = Object.entries(rest)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");

  const label = config.color
    ? `${ANSI[level]}${LABEL[level]}${RESET}`
    : LABEL[level];

  console.log(
    `${new Date().toISOString()} ${label}${scope} ${message}${extra ? ` ${extra}` : ""}`,
  );
}

export const logger = {
  debug: (message: string, fields?: LogFields) => log("debug", message, fields),
  info: (message: string, fields?: LogFields) => log("info", message, fields),
  warn: (message: string, fields?: LogFields) => log("warn", message, fields),
  error: (message: string, fields?: LogFields) => log("error", message, fields),
};
