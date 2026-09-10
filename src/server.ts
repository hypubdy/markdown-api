import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { env } from "./config/env";
import { closeDatabase, seedDemoAdmin } from "./data/index";
import { ensureUtf8Console } from "./utils/utf8-console";

async function main() {
  ensureUtf8Console();
  await seedDemoAdmin();
  const app = createApp();
  const server = serve({ fetch: app.fetch, port: env.PORT }, () => {
    console.log(`🚀 Hono server đang chạy tại http://localhost:${env.PORT} (môi trường: ${env.NODE_ENV}, DB: ${env.DB_DRIVER})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\nNhận tín hiệu ${signal}, đang tắt server...`);
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Khởi động thất bại:", error);
  process.exit(1);
});
