#!/usr/bin/env node
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dbFile = process.env.DB_FILE || "dev.sqlite";
if (!existsSync(dbFile)) {
  throw new Error(`SQLite database not found: ${dbFile}`);
}

const db = new DatabaseSync(dbFile);
try {
  db.exec("PRAGMA foreign_keys = ON");
  const columns = db.prepare("PRAGMA table_info(users)").all();
  if (!columns.some((column) => column.name === "clerk_user_id")) {
    db.exec("ALTER TABLE users ADD COLUMN clerk_user_id TEXT");
    console.log("[migration] Added users.clerk_user_id");
  } else {
    console.log("[migration] users.clerk_user_id already exists");
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_user_id_unique
      ON users (clerk_user_id)
      WHERE clerk_user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_notes_owner_id
      ON notes (owner_id);
    CREATE INDEX IF NOT EXISTS idx_notes_owner_updated
      ON notes (owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notes_owner_deleted
      ON notes (owner_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_note_tags_tag_id
      ON note_tags (tag_id);
  `);

  db.exec("PRAGMA user_version = 1");
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    throw new Error(`Foreign-key violations after migration: ${JSON.stringify(violations)}`);
  }
  console.log(`[migration] SQLite schema is current: ${dbFile}`);
} finally {
  db.close();
}
