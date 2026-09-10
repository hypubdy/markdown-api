import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { resetLoggerConfig } from "../src/utils/logger";
import {
  createQueryStats,
  instrumentRepository,
  summarizeQueryArgs,
} from "../src/utils/query-logger";

/**
 * TEST cho tầng log (src/utils/logger.ts + src/utils/query-logger.ts +
 * middleware requestLogger).
 *
 * Lưu ý: cấu hình log được CACHE lần đọc đầu → mỗi test phải set process.env
 * RỒI gọi resetLoggerConfig() trước khi chạy.
 */

const ENV_KEYS = [
  "LOG_LEVEL",
  "LOG_QUERIES",
  "LOG_QUERY_ARGS",
  "SLOW_QUERY_MS",
  "SLOW_REQUEST_MS",
  "LOG_JSON",
  "LOG_COLOR",
] as const;

let saved: Record<string, string | undefined> = {};

/** Bật log chi tiết, tắt màu/JSON để dễ so khớp chuỗi. */
function usePlainDebugLogs(extra: Record<string, string> = {}): void {
  process.env.LOG_LEVEL = "debug";
  process.env.LOG_QUERIES = "true";
  process.env.LOG_JSON = "false";
  process.env.LOG_COLOR = "false";
  for (const [key, value] of Object.entries(extra)) process.env[key] = value;
  resetLoggerConfig();
}

/** Bắt mọi dòng console.log lại để kiểm tra nội dung log. */
function captureLogs(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetLoggerConfig();
  vi.restoreAllMocks();
});

describe("instrumentRepository", () => {
  it("log mỗi query kèm requestId và cộng dồn thống kê", async () => {
    usePlainDebugLogs();
    const lines = captureLogs();
    const stats = createQueryStats("abc12345");

    class FakeNoteRepository {
      async findById(id: string): Promise<string> {
        return id;
      }
    }

    const repo = instrumentRepository(new FakeNoteRepository(), "notes", stats);
    await expect(repo.findById("n-1")).resolves.toBe("n-1");

    expect(stats.count).toBe(1);
    expect(stats.totalMs).toBeGreaterThanOrEqual(0);
    expect(stats.byTarget.get("notes")).toMatchObject({ count: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[req abc12345]");
    expect(lines[0]).toContain("query notes.findById");
  });

  it("query vượt SLOW_QUERY_MS bị log ở mức WARN và đếm vào stats.slow", async () => {
    // ngưỡng 0 → mọi query đều bị coi là chậm
    usePlainDebugLogs({ SLOW_QUERY_MS: "0" });
    const lines = captureLogs();
    const stats = createQueryStats();

    class FakeRepo {
      async list(): Promise<string[]> {
        return [];
      }
    }

    await instrumentRepository(new FakeRepo(), "notes", stats).list();

    expect(stats.slow).toBe(1);
    expect(lines.some((line) => line.includes("WARN") && line.includes("query CHẬM notes.list"))).toBe(true);
  });

  it("query lỗi được log, đếm vào stats.failed và vẫn ném lỗi ra ngoài", async () => {
    usePlainDebugLogs();
    const lines = captureLogs();
    const stats = createQueryStats();

    class FakeRepo {
      async create(): Promise<never> {
        throw new Error("DB nổ");
      }
    }

    const repo = instrumentRepository(new FakeRepo(), "users", stats);
    await expect(repo.create()).rejects.toThrow("DB nổ");

    expect(stats.failed).toBe(1);
    expect(stats.count).toBe(1);
    expect(lines.some((line) => line.includes("ERROR") && line.includes("query users.create LỖI"))).toBe(true);
  });

  it("hàm đồng bộ (không trả Promise) vẫn được đo", () => {
    usePlainDebugLogs();
    const lines = captureLogs();
    const stats = createQueryStats();

    class SyncRepo {
      ping(): string {
        return "pong";
      }
    }

    const repo = instrumentRepository(new SyncRepo(), "notes", stats);
    expect(repo.ping()).toBe("pong");
    expect(stats.count).toBe(1);
    expect(lines[0]).toContain("query notes.ping");
  });
});

describe("summarizeQueryArgs", () => {
  it("giữ dữ liệu thường nhưng che password/token", () => {
    const text = summarizeQueryArgs([
      { email: "a@b.com", password: "mat-khau-that", token: "jwt-that", apiKey: "key-that" },
    ]);

    expect(text).toContain("a@b.com");
    expect(text).not.toContain("mat-khau-that");
    expect(text).not.toContain("jwt-that");
    expect(text).not.toContain("key-that");
    expect(text).toContain("[đã che]");
  });

  it("cắt ngắn chuỗi quá dài", () => {
    const text = summarizeQueryArgs([{ content: "x".repeat(500) }], 40);
    expect(text.length).toBeLessThanOrEqual(41);
    expect(text.endsWith("…")).toBe(true);
  });

  it("không nổ với dữ liệu vòng tròn", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => summarizeQueryArgs([circular])).not.toThrow();
  });
});

describe("middleware requestLogger", () => {
  it("gắn cùng một requestId cho dòng request và các dòng query DB", async () => {
    usePlainDebugLogs();
    const lines = captureLogs();

    const app = createApp();
    const email = `log-test-${randomUUID()}@example.com`;
    const res = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Người Test Log", email, password: "matkhau123" }),
    });

    expect(res.status).toBe(201);

    const requestLine = lines.find((line) => line.includes("POST /api/v1/auth/register 201"));
    expect(requestLine).toBeDefined();

    const requestId = /\[req ([0-9a-f]{8})\]/.exec(requestLine as string)?.[1];
    expect(requestId).toBeTruthy();

    // register = findByEmail + create ⇒ 2 query, đều mang cùng requestId
    expect(requestLine).toContain("queries=2");
    // register = findByEmail + create; `create` có bcrypt nên có thể bị log ở mức WARN
    const queryLines = lines.filter((line) => /query (CHẬM )?users\./.test(line));
    expect(queryLines).toHaveLength(2);
    expect(queryLines.every((line) => line.includes(`[req ${requestId}]`))).toBe(true);
    expect(lines.every((line) => line.includes(`[req ${requestId}]`))).toBe(true);
  });

  it("đếm query = 0 cho endpoint không đụng DB", async () => {
    usePlainDebugLogs();
    const lines = captureLogs();

    const res = await createApp().request("/api/v1/health");

    expect(res.status).toBe(200);
    const requestLine = lines.find((line) => line.includes("GET /api/v1/health 200"));
    expect(requestLine).toBeDefined();
    expect(requestLine).toContain("queries=0");
  });

  it("lỗi 500 vẫn có dòng tổng kết request (mức ERROR) và đi qua errorHandler", async () => {
    usePlainDebugLogs();
    const lines = captureLogs();

    // Endpoint public không cần token → dễ ép lỗi 500 bằng service ném Error thường
    const boom = {
      findByShareToken: async () => {
        throw new Error("DB sập");
      },
    };
    const app = createApp({
      getUserRepository: async () => {
        throw new Error("không dùng tới");
      },
      getNoteRepository: async () => boom as never,
    });

    const res = await app.request("/api/v1/public/notes/khong-ton-tai");

    expect(res.status).toBe(500);
    const requestLine = lines.find((line) =>
      line.includes("GET /api/v1/public/notes/khong-ton-tai 500"),
    );
    expect(requestLine).toBeDefined();
    expect(requestLine).toContain("ERROR");
    expect(requestLine).toContain('error="DB sập"');
    expect(lines.some((line) => line.includes("Lỗi không xác định: DB sập"))).toBe(true);
  });

  it("SLOW_REQUEST_MS thấp → request bị nâng lên WARN", async () => {
    usePlainDebugLogs({ SLOW_REQUEST_MS: "0" });
    const lines = captureLogs();

    await createApp().request("/api/v1/health");

    expect(lines.some((line) => line.includes("WARN") && line.includes("request CHẬM"))).toBe(true);
  });
});
