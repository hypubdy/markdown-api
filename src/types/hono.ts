import type { Context, Env } from "hono";
import type { NoteRepository } from "../data/note.repository";
import type { UserRepository } from "../data/user.repository";
import type { AuthUser } from "./index";

export interface AppBindings {
  NODE_ENV?: "development" | "test" | "production";
  AUTH_PROVIDER?: "local" | "clerk";
  JWT_SECRET?: string;
  JWT_EXPIRES_IN?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
}

export interface ValidatedRequest {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

export interface RuntimeServices {
  getUserRepository(): Promise<UserRepository>;
  getNoteRepository(): Promise<NoteRepository>;
}

export interface AppVariables {
  user?: AuthUser;
  validated?: ValidatedRequest;
  services: RuntimeServices;
}

export interface AppEnv extends Env {
  Bindings: AppBindings;
  Variables: AppVariables;
}

export type AppContext = Context<AppEnv>;
