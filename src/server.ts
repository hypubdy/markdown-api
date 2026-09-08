import { createApp } from "./app";
import { env } from "./config/env";
import { closeDatabase, seedDemoAdmin } from "./data/index";

async function main() {
  // Khởi tạo DB (bảng + tài khoản admin demo) trước khi nhận request
  await seedDemoAdmin();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(
      `🚀 Server đang chạy tại http://localhost:${env.PORT} (môi trường: ${env.NODE_ENV}, DB: ${env.DB_DRIVER})`,
    );
  });

  // Tắt máy an toàn (graceful shutdown)
  const shutdown = async (signal: string) => {
    console.log(`\nNhận tín hiệu ${signal}, đang tắt server...`);
    server.close(async () => {
      await closeDatabase();
      console.log("Đã đóng server và DB. Tạm biệt!");
      process.exit(0);
    });
    // An toàn: ép thoát nếu kết nối còn treo
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Khởi động thất bại:", error);
  process.exit(1);
});
