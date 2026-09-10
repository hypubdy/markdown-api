import type { D1Database } from "@cloudflare/workers-types";
import type { NoteRepository } from "./note.repository";
import { D1NoteRepository } from "./note.d1.repository";
import type { UserRepository } from "./user.repository";
import { D1UserRepository } from "./user.d1.repository";

let db: D1Database | undefined;
let users: UserRepository | undefined;
let notes: NoteRepository | undefined;

export function configureDatabase(binding: D1Database): void {
  if (db && db !== binding) {
    users = undefined;
    notes = undefined;
  }
  db = binding;
}

function getDatabase(): D1Database {
  if (!db) throw new Error("Cloudflare D1 binding DB is not configured");
  return db;
}

export async function getUserRepository(): Promise<UserRepository> {
  return (users ??= new D1UserRepository(getDatabase()));
}

export async function getNoteRepository(): Promise<NoteRepository> {
  return (notes ??= new D1NoteRepository(getDatabase()));
}

/** Worker không chạy DDL; schema được quản lý bởi Wrangler D1 migrations. */
export async function initDatabase(): Promise<void> {
  getDatabase();
  await (await getUserRepository()).init();
  await (await getNoteRepository()).init();
}

export async function closeDatabase(): Promise<void> {
  db = undefined;
  users = undefined;
  notes = undefined;
}
