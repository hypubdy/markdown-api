import type { Hono } from "hono";
import type { AppEnv } from "../../src/types/hono";
import { expect } from "vitest";

/**
 * ENGINE CHUNG cho integration test data-driven (không phải file test).
 * File test chỉ cần: nạp bảng case (object) + createCaseRunner(app).run(case).
 */

export type HttpMethod = "get" | "post" | "patch" | "delete";

export interface ExpectRule {
  /** Đường dẫn trong body response, vd "data.user.email" */
  path: string;
  /** giá trị phải bằng (có thể dùng placeholder "$...") */
  equals?: unknown;
  /** trường phải tồn tại */
  exists?: boolean;
  /** trường phải KHÔNG tồn tại */
  notExists?: boolean;
  /** giá trị phải là UUID */
  isUuid?: boolean;
  /** mảng tại path phải chứa phần tử có .field === giá trị này (details lỗi validate) */
  containsField?: string;
  /** mảng tại path phải chứa phần tử có [field] === equals */
  includesItem?: { field: string; equals: unknown };
  /** mảng tại path phải có đúng độ dài này */
  length?: number;
}

export interface TestCase {
  /** tên case — hiển thị trong báo cáo vitest */
  name: string;
  method: HttpMethod;
  /** đường dẫn tương đối, vd "/auth/login" (prefix /api/v1 tự thêm) */
  path: string;
  /** placeholder token, vd "$adminToken" — bỏ trống nếu không cần xác thực */
  token?: string;
  body?: Record<string, unknown>;
  expectedStatus: number;
  expect?: ExpectRule[];
  /** trích giá trị từ response vào biến dùng cho case sau: { "userAToken": "data.token" } */
  save?: Record<string, string>;
}

/** Biến mặc định có sẵn cho mọi runner */
const DEFAULT_VARS: Record<string, unknown> = {
  tokenSai: "token-sai-khong-hop-le", // dùng cho case kiểm tra token không hợp lệ
};

/**
 * Tạo một runner có state riêng (biến lưu giữa các case theo thứ tự chạy).
 * @param app         instance Express cần test
 * @param initialVars biến khởi tạo bổ sung (vd token/fixture chuẩn bị trước) —
 *                    ghi đè biến mặc định nếu trùng key
 */
export function createCaseRunner(
  app: Hono<AppEnv>,
  initialVars: Record<string, unknown> = {},
) {
  const vars: Record<string, unknown> = { ...DEFAULT_VARS, ...initialVars };
  let uniqueCounter = 0;

  /** Thay mọi placeholder "$ten" trong chuỗi (dùng cho path, token...) bằng giá trị biến */
  function resolveString(value: string): string {
    return value.replace(/\$(\w+)/g, (_match, key: string) => {
      if (key === "uniqueEmail") {
        return `user-${Date.now()}-${++uniqueCounter}@example.com`;
      }
      if (key in vars) return String(vars[key]);
      throw new Error(`Test case tham chiếu biến chưa có: "$${key}"`);
    });
  }

  /** Thay placeholder "$ten" bằng biến, "$uniqueEmail" bằng email tự sinh */
  function resolveValue(value: unknown): unknown {
    if (typeof value !== "string" || !value.startsWith("$")) return value;

    const key = value.slice(1);
    if (key === "uniqueEmail") {
      return `user-${Date.now()}-${++uniqueCounter}@example.com`;
    }
    if (key in vars) return vars[key];
    throw new Error(`Test case tham chiếu biến chưa có: "${value}"`);
  }

  /** Giải placeholder trong toàn bộ body (đệ quy qua object) */
  function resolveBody(body: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!body) return undefined;
    return Object.fromEntries(
      Object.entries(body).map(([k, v]) => [
        k,
        v && typeof v === "object"
          ? resolveBody(v as Record<string, unknown>)
          : resolveValue(v),
      ]),
    );
  }

  /** Lấy giá trị theo đường dẫn "data.user.email" */
  function getPath(obj: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
  }

  /** Kiểm tra một rule trên body response */
  function checkRule(body: unknown, rule: ExpectRule): void {
    const actual = getPath(body, rule.path);

    if (rule.equals !== undefined) {
      expect(actual).toEqual(resolveValue(rule.equals));
    } else if (rule.exists) {
      expect(actual).toBeDefined();
    } else if (rule.notExists) {
      expect(actual).toBeUndefined();
    } else if (rule.isUuid) {
      expect(actual).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    } else if (rule.containsField !== undefined) {
      const arr = actual as Array<{ field?: string }> | undefined;
      expect(Array.isArray(arr)).toBe(true);
      expect(arr!.some((item) => item?.field === rule.containsField)).toBe(true);
    } else if (rule.includesItem) {
      const arr = actual as Array<Record<string, unknown>> | undefined;
      expect(Array.isArray(arr)).toBe(true);
      expect(
        arr!.some(
          (item) =>
            item?.[rule.includesItem!.field] ===
            resolveValue(rule.includesItem!.equals),
        ),
      ).toBe(true);
    } else if (rule.length !== undefined) {
      const arr = actual as unknown[];
      expect(Array.isArray(arr)).toBe(true);
      expect(arr).toHaveLength(rule.length);
    }
  }

  /** Gọi request trực tiếp qua Hono Fetch API. */
  async function exec(case_: TestCase): Promise<{ status: number; body: unknown }> {
    const url = `/api/v1${resolveString(case_.path)}`;
    const headers: Record<string, string> = {};
    if (case_.token) headers.Authorization = `Bearer ${resolveValue(case_.token)}`;
    const body = resolveBody(case_.body);
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await app.request(url, {
      method: case_.method.toUpperCase(),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }
    return { status: response.status, body: parsed };
  }

  /** Chạy một case: gọi request → assert status/expect → lưu biến cho case sau */
  async function run(case_: TestCase): Promise<void> {
    const res = await exec(case_);
    expect(res.status).toBe(case_.expectedStatus);
    for (const rule of case_.expect ?? []) checkRule(res.body, rule);
    if (case_.save) {
      for (const [name, path] of Object.entries(case_.save)) vars[name] = getPath(res.body, path);
    }
  }

  return { run };
}
