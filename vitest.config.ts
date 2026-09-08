import { defineConfig } from "vitest/config";

/**
 * TEST LUÔN CHẠY TRÊN SQLite (DB thật = PostgreSQL chỉ dùng khi chạy server).
 * - Mặc định: DB_FILE=":memory:" → DB trong RAM, mỗi worker 1 DB sạch, chạy song song nhanh.
 * - Debug: TEST_DB_FILE=test.sqlite npm run test:file → DB là FILE còn lại sau khi chạy
 *   để mở ra xem/kiểm tra dữ liệu; chạy tuần tự (fileParallelism=false) vì dùng chung 1 file.
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
  },
});
