import { defineConfig } from "vitest/config";

/**
 * TEST CHẾ ĐỘ CLERK — chạy RIÊNG worker với AUTH_PROVIDER=clerk
 * (npm run test:clerk). Khác vitest.config.ts: không ghim AUTH_PROVIDER=local
 * vì file này kiểm tra luồng xác thực qua Clerk (mocked, không gọi mạng thật).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/clerk.test.ts"],
    env: {
      AUTH_PROVIDER: "clerk",
      CLERK_PUBLISHABLE_KEY: "pk_test_mock",
      CLERK_SECRET_KEY: "sk_test_mock",
      DB_DRIVER: "sqlite",
      DB_FILE: ":memory:",
      // Xem vitest.config.ts — giữ log im lặng khi chạy test.
      LOG_LEVEL: "warn",
    },
    sequence: { concurrent: false },
  },
});