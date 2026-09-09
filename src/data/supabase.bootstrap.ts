import { Client } from "pg";

/**
 * BOOTSTRAP LƯỢC ĐỒ SUPABASE — chạy DDL (CREATE TABLE IF NOT EXISTS) qua kết nối
 * Postgres thật để app TỰ TẠO BẢNG lúc khởi động, giống như driver SQLite/PG cũ.
 *
 * Vì sao cần `pg` mà không dùng PostgREST:
 * - PostgREST chỉ đọc/ghi dữ liệu, KHÔNG chạy được DDL.
 * - Muốn `CREATE TABLE` phải có kết nối Postgres (connection string) qua `pg`.
 *
 * Sau khi bảng tồn tại, mọi truy vấn vẫn đi qua PostgREST (@supabase/postgrest-js),
 * nên driver vẫn chạy được trên Cloudflare Worker (chỉ bước khởi tạo này dùng `pg`).
 *
 * LƯU Ý: nội dung DDL dưới đây phải luôn GIỐNG `supabase/schema.sql` (bản chạy tay
 * trong SQL Editor). Nếu đổi bảng, sửa cả 2 chỗ.
 */
export const SUPABASE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS public.users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user'
                CHECK (role IN ('admin', 'user')),
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.notes (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'published')),
  deleted_at  TIMESTAMPTZ,
  share_token TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.tags (
  id       TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS public.note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_owner_id      ON public.notes (owner_id);
CREATE INDEX IF NOT EXISTS idx_notes_owner_updated ON public.notes (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_owner_deleted ON public.notes (owner_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag_id    ON public.note_tags (tag_id);
`;

/**
 * Kết nối tới Postgres của Supabase và chạy DDL một lần (idempotent — an toàn gọi lại).
 * @param connectionString VD postgresql://postgres:<pass>@db.<ref>.supabase.co:5432/postgres
 *
 * LƯU Ý SSL: gọi tới host của Supabase thường gặp "self-signed certificate in
 * certificate chain" (do proxy/TLS chặn). Vì vậy dùng `rejectUnauthorized: false`
 * để bỏ qua xác thực CA — chấp nhận được khi connect từ máy dev; khi lên production
 * nên đổi sang xác thực đầy đủ (verify-full + CA đúng).
 */
export async function bootstrapSupabaseSchema(connectionString: string): Promise<void> {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(SUPABASE_SCHEMA_SQL);
  } finally {
    await client.end();
  }
}
