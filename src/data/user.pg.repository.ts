import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
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
 * Driver POSTGRESQL (pg) — dùng cho chạy thật (production/dev có DB server).
 * Cấu hình qua env: DB_DRIVER=postgres + DATABASE_URL.
 */
export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user'
                      CHECK (role IN ('admin', 'user')),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SELECT_COLUMNS}`,
      [
        randomUUID(),
        input.name,
        input.email.toLowerCase(),
        await hashPassword(input.password),
        input.role ?? "user",
        now,
        now,
      ],
    );
    return mapUserRow(rows[0] as UserRow);
  }

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM users WHERE email = $1`,
      [email.toLowerCase()],
    );
    return rows[0] ? mapUserRow(rows[0] as UserRow) : null;
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapUserRow(rows[0] as UserRow) : null;
  }

  async findAll(): Promise<User[]> {
    const { rows } = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM users ORDER BY created_at ASC`,
    );
    return rows.map((row) => mapUserRow(row as UserRow));
  }

  async updateRole(id: string, role: UserRole): Promise<User | null> {
    const { rows } = await this.pool.query(
      `UPDATE users SET role = $2, updated_at = now() WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [id, role],
    );
    return rows[0] ? mapUserRow(rows[0] as UserRow) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      "DELETE FROM users WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  }
}
