import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().default(3000),
    JWT_SECRET: z
      .string()
      .min(1, "Thiếu JWT_SECRET — hãy copy .env.example thành .env"),
    JWT_EXPIRES_IN: z.string().default("15m"),

    // ── Cơ sở dữ liệu ─────────────────────────────────────────────
    // sqlite: chạy/mock dễ (test dùng), postgres: chạy thật
    DB_DRIVER: z.enum(["postgres", "sqlite"]).default("sqlite"),
    // sqlite: đường dẫn file db (":memory:" = db trong RAM, dùng cho test)
    DB_FILE: z.string().default(":memory:"),
    // postgres: chuỗi kết nối, vd postgres://user:pass@localhost:5432/db
    DATABASE_URL: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.DB_DRIVER === "postgres" && !val.DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        message: "Thiếu DATABASE_URL khi DB_DRIVER=postgres",
        path: ["DATABASE_URL"],
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Cấu hình môi trường không hợp lệ:", parsed.error.flatten());
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
