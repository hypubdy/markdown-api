import type { PostgrestClient } from "@supabase/postgrest-js";
import { env } from "../config/env";
import { createSupabaseClient } from "./supabase.client";
import type { NoteRepository } from "./note.repository";
import { SupabaseNoteRepository } from "./note.supabase.repository";
import type { UserRepository } from "./user.repository";
import { SupabaseUserRepository } from "./user.supabase.repository";

let client: PostgrestClient | undefined;
let users: UserRepository | undefined;
let notes: NoteRepository | undefined;

function getClient(): PostgrestClient {
  return (client ??= createSupabaseClient());
}

export async function getUserRepository(): Promise<UserRepository> {
  return (users ??= new SupabaseUserRepository(getClient()));
}

export async function getNoteRepository(): Promise<NoteRepository> {
  return (notes ??= new SupabaseNoteRepository(getClient()));
}

/** Worker chỉ kiểm tra schema đã được migrate bên ngoài; không chạy pg DDL. */
export async function initDatabase(): Promise<void> {
  if (env.DB_DRIVER !== "supabase") throw new Error("Worker chỉ hỗ trợ Supabase");
  await (await getUserRepository()).init();
  await (await getNoteRepository()).init();
}

export async function closeDatabase(): Promise<void> {
  client = undefined;
  users = undefined;
  notes = undefined;
}
