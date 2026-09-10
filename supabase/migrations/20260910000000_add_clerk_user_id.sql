ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_user_id_unique
  ON public.users (clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;
