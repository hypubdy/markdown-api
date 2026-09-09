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
    // sqlite: chạy/mock dễ (test dùng, dev nhanh không cần DB server)
    // supabase: chạy thật — PostgreSQL của Supabase, dùng driver fetch-based
    //           (@supabase/postgrest-js) nên chạy được trên Cloudflare Worker.
    DB_DRIVER: z.enum(["supabase", "sqlite"]).default("sqlite"),
    // sqlite: đường dẫn file db (":memory:" = db trong RAM, dùng cho test)
    DB_FILE: z.string().default(":memory:"),
    // supabase: URL dự án Supabase, vd https://<project-ref>.supabase.co
    SUPABASE_URL: z.string().optional(),
    // supabase: service_role key (bỏ qua RLS) — dùng cho phía server/quản trị
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    // supabase (tùy chọn): connection string Postgres — CHỈ dùng để TỰ TẠO BẢNG
    // (DDL) lúc khởi động qua `pg`. Nếu không đặt, bạn phải tạo bảng trước bằng
    // supabase/schema.sql (SQL Editor) rồi app mới chạy được.
    DATABASE_URL: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.DB_DRIVER === "supabase" && (!val.SUPABASE_URL || !val.SUPABASE_SERVICE_ROLE_KEY)) {
      ctx.addIssue({
        code: "custom",
        message:
          "Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY khi DB_DRIVER=supabase",
        path: ["SUPABASE_URL"],
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
