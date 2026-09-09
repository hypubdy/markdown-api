import { PostgrestClient } from "@supabase/postgrest-js";
import { env } from "../config/env";

/**
 * Tạo PostgREST client nối tới Supabase.
 *
 * Vì Supabase chỉ expose DB qua HTTP (PostgREST + fetch) nên driver này chạy được
 * cả trên Node lẫn trên Cloudflare Worker (không cần TCP socket như node-postgres).
 *
 * Dùng SERVICE_ROLE key (bỏ qua RLS) vì app tự quản lý auth bằng JWT riêng, không
 * dùng Supabase Auth; do đó mọi truy vấn repo đều là query phía server.
 */
export function createSupabaseClient(): PostgrestClient {
  return new PostgrestClient(`${env.SUPABASE_URL}/rest/v1`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
}
