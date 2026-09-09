import { randomUUID } from "node:crypto";
import type { PostgrestClient } from "@supabase/postgrest-js";
import type { CreateUserInput, User, UserRole } from "../types/index";
import {
  hashPassword,
  mapUserRow,
  type UserRepository,
  type UserRow,
} from "./user.repository";

const SELECT_COLUMNS =
  "id, name, email, password_hash, role, created_at, updated_at";

/**
 * Driver SUPABASE (PostgREST qua @supabase/postgrest-js) — dùng cho chạy thật và
 * chạy được trên Cloudflare Worker (fetch-based, không cần TCP socket).
 *
 * Cấu hình qua env: DB_DRIVER=supabase + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * LƯU Ý QUAN TRỌNG:
 * - `init()` là no-op: PostgREST chỉ truy vấn dữ liệu, KHÔNG tạo bảng. Các bảng
 *   phải được tạo trước bằng `supabase/schema.sql` (chạy 1 lần trong SQL Editor/
 *   `supabase db push`). Xem README.
 * - Bảng `users` KHÔNG được bật RLS (hoặc dùng service role key — app đã dùng
 *   service role nên RLS bị bỏ qua). App tự quản lý auth bằng JWT, không dùng
 *   Supabase Auth.
 * - DÙNG CHUNG client với SupabaseNoteRepository.
 */
export class SupabaseUserRepository implements UserRepository {
  constructor(private readonly sb: PostgrestClient) {}

  /**
   * PostgREST không hỗ trợ DDL — bảng đã được tạo bởi supabase/schema.sql.
   * Gọi hàm này chỉ để kiểm tra bảng tồn tại (HEAD request nhẹ) và báo lỗi rõ ràng nếu thiếu.
   */
  async init(): Promise<void> {
    const { error } = await this.sb.from("users").select("id", { head: true });
    if (error) {
      throw new Error(
        `Supabase không truy vấn được bảng users (đã chạy supabase/schema.sql chưa?): ${error.message}`,
      );
    }
  }

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      name: input.name,
      email: input.email.toLowerCase(),
      password_hash: await hashPassword(input.password),
      role: input.role ?? "user",
      created_at: now,
      updated_at: now,
    };
    const { data, error } = await this.sb
      .from("users")
      .insert(row)
      .select(SELECT_COLUMNS);
    if (error) throw error;
    return mapUserRow((data as UserRow[])[0]);
  }

  async findByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.sb
      .from("users")
      .select(SELECT_COLUMNS)
      .eq("email", email.toLowerCase())
      .maybeSingle();
    if (error) throw error;
    return data ? mapUserRow(data as UserRow) : null;
  }

  async findById(id: string): Promise<User | null> {
    const { data, error } = await this.sb
      .from("users")
      .select(SELECT_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapUserRow(data as UserRow) : null;
  }

  async findAll(): Promise<User[]> {
    const { data, error } = await this.sb
      .from("users")
      .select(SELECT_COLUMNS)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as UserRow[]).map(mapUserRow);
  }

  async updateRole(id: string, role: UserRole): Promise<User | null> {
    const { data, error } = await this.sb
      .from("users")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(SELECT_COLUMNS);
    if (error) throw error;
    const row = (data as UserRow[] | null)?.[0];
    return row ? mapUserRow(row) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    const { data, error } = await this.sb
      .from("users")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    return ((data as { id: string }[] | null)?.length ?? 0) > 0;
  }
}
