-- ============================================================================
-- SUPABASE / PostgreSQL schema — chạy 1 lần để tạo bảng cho driver "supabase".
--
-- CÁCH CHẠY:
--   A) Supabase Dashboard → SQL Editor → dán toàn bộ file này → Run.
--   B) Hoặc dùng Supabase CLI:  supabase db push   (với file trong supabase/migrations)
--
-- LƯU Ý:
--   - App tự quản lý auth bằng JWT riêng (không dùng Supabase Auth) → KHÔNG bật
--     RLS (Row Level Security) cho các bảng này. Nếu bật RLS, phải tạo policy
--     cho service_role (thực tế service_role luôn bypass RLS nên vẫn chạy được).
--   - Các cột id/chia sẻ dạng TEXT do app sinh UUID (giống driver SQLite).
--   - Phải chạy file này TRƯỚC khi DB_DRIVER=supabase, nếu không repo sẽ báo lỗi
--     "relation ... does not exist".
-- ============================================================================

-- 1) users -----------------------------------------------------------------
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

-- 2) notes -----------------------------------------------------------------
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

-- 3) tags ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tags (
  id       TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  UNIQUE (owner_id, name)
);

-- 4) note_tags (join table giữa notes và tags) ------------------------------
CREATE TABLE IF NOT EXISTS public.note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

-- 5) Indexes (đồng nhất với driver SQLite/PG cũ) ----------------------------
CREATE INDEX IF NOT EXISTS idx_notes_owner_id      ON public.notes (owner_id);
CREATE INDEX IF NOT EXISTS idx_notes_owner_updated ON public.notes (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_owner_deleted ON public.notes (owner_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag_id    ON public.note_tags (tag_id);
