import type { D1Database } from "@cloudflare/workers-types";
import type { CreateUserInput, User, UserRole } from "../types/index";
import {
  hashPassword,
  mapUserRow,
  type UserRepository,
  type UserRow,
} from "./user.repository";

const SELECT_COLUMNS =
  "id, name, email, password_hash, role, clerk_user_id, created_at, updated_at";

/** Cloudflare D1 repository. Schema is managed by Wrangler migrations. */
export class D1UserRepository implements UserRepository {
  constructor(private readonly db: D1Database) {}

  async init(): Promise<void> {
    // D1 migrations run before deploy/request handling; never run DDL per request.
  }

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date().toISOString();
    const user: User = {
      id: crypto.randomUUID(),
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      role: input.role ?? "user",
      createdAt: now,
      updatedAt: now,
    };

    await this.db
      .prepare(
        `INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        user.id,
        user.name,
        user.email,
        user.passwordHash,
        user.role,
        user.createdAt,
        user.updatedAt,
      )
      .run();

    return user;
  }

  async findByClerkUserId(clerkUserId: string): Promise<User | null> {
    const row = await this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM users WHERE clerk_user_id = ?`)
      .bind(clerkUserId)
      .first<UserRow>();
    return row ? mapUserRow(row) : null;
  }

  async setClerkUserId(id: string, clerkUserId: string): Promise<User | null> {
    await this.db
      .prepare(
        "UPDATE users SET clerk_user_id = ?, updated_at = ? WHERE id = ?",
      )
      .bind(clerkUserId, new Date().toISOString(), id)
      .run();
    return this.findById(id);
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM users WHERE email = ?`)
      .bind(email.toLowerCase())
      .first<UserRow>();
    return row ? mapUserRow(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`)
      .bind(id)
      .first<UserRow>();
    return row ? mapUserRow(row) : null;
  }

  async findAll(): Promise<User[]> {
    const result = await this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM users ORDER BY created_at ASC`)
      .all<UserRow>();
    return result.results.map(mapUserRow);
  }

  async updateRole(id: string, role: UserRole): Promise<User | null> {
    const result = await this.db
      .prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
      .bind(role, new Date().toISOString(), id)
      .run();
    return result.meta.changes > 0 ? this.findById(id) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM users WHERE id = ?")
      .bind(id)
      .run();
    return result.meta.changes > 0;
  }
}
