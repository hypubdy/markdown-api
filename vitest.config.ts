import { defineConfig } from "vitest/config";

/**
 * TEST LUÔN CHẠY TRÊN SQLite (DB thật = PostgreSQL chỉ dùng khi chạy server).
 * - Mặc định: DB_FILE=":memory:" → DB trong RAM, mỗi worker 1 DB sạch, chạy song song nhanh.
 * - Debug: TEST_DB_FILE=test.sqlite npm run test:file → DB là FILE còn lại sau khi chạy
 *   để mở ra xem/kiểm tra dữ liệu; chạy tuần tự (fileParallelism=false) vì dùng chung 1 file.
 *
 * COVERAGE: npm run coverage (= vitest run --coverage)
 * - Provider v8 (cần @vitest/coverage-v8).
 * - include src/** ; loại các file điểm vào KHÔNG được test chạy tới
 *   (server.ts khởi động thật, seed.ts chạy độc lập).
 * - Lưu ý: bộ test là INTEGRATION (qua HTTP) nên % phản ánh độ phủ theo luồng HTTP;
 *   các driver PostgreSQL KHÔNG được nạp khi test chạy SQLite → hiện 0% (đúng bản chất).
 */
const fileDb = process.env.TEST_DB_FILE;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      DB_DRIVER: "sqlite",
      DB_FILE: fileDb ?? ":memory:",
    },
    // Chạy tuần tự trong file: các case dùng chung 1 DB (cần thứ tự để lưu biến).
    // Khi debug bằng file, đồng thời chạy tuần tự GIỮA các file (dùng chung 1 file DB).
    sequence: { concurrent: false },
    fileParallelism: !fileDb,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "json-summary"],
      include: ["src/**/*.ts"],
      // Loại: điểm vào không được test chạy tới + file type-only (không có code runtime)
      exclude: ["src/server.ts", "src/seed.ts", "src/types/**"],
      // Ngưỡng bắt buộc (toàn bộ code trong include) — fail nếu tụt dưới.
      // Đo lúc cài: Statements 72.1 / Branches 53.2 / Functions 71.2 / Lines 73.7
      thresholds: {
        statements: 70,
        branches: 50,
        functions: 70,
        lines: 70,
      },
    },
  },
});
