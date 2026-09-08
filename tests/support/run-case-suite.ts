import { beforeAll, describe, it } from "vitest";
import { createApp } from "../../src/app";
import { env } from "../../src/config/env";
import { seedDemoAdmin } from "../../src/data/index";
import type { TestCase } from "./case-runner";
import { createCaseRunner } from "./case-runner";

/**
 * HÀM DÙNG CHUNG: đăng ký một suite test data-driven từ bảng test case.
 * Mỗi file test khai báo bảng case NGAY TRONG FILE rồi gọi hàm này:
 *
 *   const appCases: TestCase[] = [ { name: "...", method: "get", path: "/", ... } ];
 *   runCaseSuite(appCases, { label: "API /api/v1 — auth & user" });
 *
 * Hàm tự lo: tạo app (hoặc nhận app truyền vào), seed dữ liệu, tạo runner
 * và đăng ký từng case thành một test() theo thứ tự khai báo.
 *
 * DB TEST:
 * - Mặc định SQLite ":memory:" (vitest.config.ts) — mỗi worker một DB sạch, chạy song song.
 * - Khi debug bằng FILE (TEST_DB_FILE=test.sqlite npm run test:file): DB là file nên mỗi
 *   suite TỰ XOÁ hết user rồi seed lại — chạy xong mở file ra xem được dữ liệu.
 */

export interface RunCaseSuiteOptions {
  /** instance Express — mặc định tạo mới bằng createApp() */
  app?: ReturnType<typeof createApp>;
  /** tiêu đề describe — mặc định tự sinh theo số case */
  label?: string;
  /** seed tài khoản admin trước suite — mặc định true */
  seed?: boolean;
  /**
   * Chạy sau seed, trước các case: chuẩn bị fixture/token rồi TRẢ VỀ biến khởi tạo
   * (những giá trị này có thể dùng làm placeholder "$ten" trong bảng case).
   * Ví dụ: trả về { adminToken: signInAs({ role: "admin" }), victimId: ... }
   */
  prepare?: () =>
    | Record<string, unknown>
    | Promise<Record<string, unknown>>;
}

/** DB test là FILE (không phải :memory:) → mỗi suite tự reset để luôn xác định */
function usingFileDb(): boolean {
  return env.DB_DRIVER === "sqlite" && env.DB_FILE !== ":memory:";
}

export function runCaseSuite(
  cases: TestCase[],
  options: RunCaseSuiteOptions = {},
) {
  const app = options.app ?? createApp();
  const label =
    options.label ?? `API — bảng test case (${cases.length} case)`;

  describe(label, () => {
    let runner: { run(case_: TestCase): Promise<void> };

    beforeAll(async () => {
      if (options.seed !== false) {
        // Reset khi DB là file để bỏ dữ liệu của lần chạy trước/worker khác
        await seedDemoAdmin({ reset: usingFileDb() });
      }
      const prepared = (await options.prepare?.()) ?? {};
      runner = createCaseRunner(app, prepared);
    });

    // Đăng ký từng case — thứ tự trong bảng = thứ tự chạy
    // (các case trong cùng file dùng chung 1 DB)
    for (const case_ of cases) {
      it(case_.name, () => runner.run(case_));
    }
  });
}
