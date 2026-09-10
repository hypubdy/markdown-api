import { randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { CreateUserInput, User, UserRole } from "../types/index";
import {
  CREATE_USERS_TABLE,
  hashPassword,
  mapUserRow,
  type UserRepository,
  type UserRow,
} from "./user.repository";

const SELECT_COLUMNS = `id, name, email, password_hash, role, created_at, updated_at`;

/**
 * Driver SQLITE (node:sqlite tích hợp sẵn trong Node ≥ 22) — dùng cho TEST
 * (DB_FILE=":memory:" trong vitest.config.ts) và dev nhanh không cần cài DB.
 * Không cần dependency ngoài, không cần server riêng → dễ mock/khởi tạo.
 */
export class SqliteUserRepository implements UserRepository {
  private insertStmt!: StatementSync;
  private selectByEmailStmt!: StatementSync;
  private selectByIdStmt!: StatementSync;
  private selectAllStmt!: StatementSync;
  private updateRoleStmt!: StatementSync;
  private deleteStmt!: StatementSync;
  private initialized = false;

  constructor(private readonly db: DatabaseSync) {}

  /** Tạo bảng (nếu chưa có) rồi chuẩn bị các câu lệnh — chạy 1 lần */
  private ensureTables(): void {
    if (this.initialized) return;

    this.db.exec(CREATE_USERS_TABLE);
    this.insertStmt = this.db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectByEmailStmt = this.db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM users WHERE email = ?`,
    );
    this.selectByIdStmt = this.db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`,
    );
    this.selectAllStmt = this.db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM users ORDER BY created_at ASC`,
    );
    this.updateRoleStmt = this.db.prepare(
      `UPDATE users SET role = ?, updated_at = ? WHERE id = ?`,
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM users WHERE id = ?`);

    this.initialized = true;
  }

  async init(): Promise<void> {
    this.ensureTables();
  }

  async create(input: CreateUserInput): Promise<User> {
    this.ensureTables();

    const now = new Date().toISOString();
    const user: User = {
      id: randomUUID(),
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      role: input.role ?? "user",
      createdAt: now,
      updatedAt: now,
    };

    this.insertStmt.run(
      user.id,
      user.name,
      user.email,
      user.passwordHash,
      user.role,
      user.createdAt,
      user.updatedAt,
    );
    return user;
  }

  async findByClerkUserId(clerkUserId: string): Promise<User | null> {
    this.ensureTables();
    const row = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM users WHERE clerk_user_id = ?`).get(clerkUserId) as UserRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  async setClerkUserId(id: string, clerkUserId: string): Promise<User | null> {
    this.ensureTables();
    this.db.prepare(`UPDATE users SET clerk_user_id = ?, updated_at = ? WHERE id = ?`).run(clerkUserId, new Date().toISOString(), id);
    const row = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    this.ensureTables();
    const row = this.selectByEmailStmt.get(email.toLowerCase()) as
      | UserRow
      | undefined;
    return row ? mapUserRow(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    this.ensureTables();
    const row = this.selectByIdStmt.get(id) as UserRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  async findAll(): Promise<User[]> {
    this.ensureTables();
    const rows = this.selectAllStmt.all() as unknown as UserRow[];
    return rows.map(mapUserRow);
  }

  async updateRole(id: string, role: UserRole): Promise<User | null> {
    this.ensureTables();

    const updatedAt = new Date().toISOString();
    const result = this.updateRoleStmt.run(role, updatedAt, id);
    if (result.changes === 0) return null;

    const row = this.selectByIdStmt.get(id) as UserRow | undefined;
    return row ? mapUserRow(row) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    this.ensureTables();
    return this.deleteStmt.run(id).changes > 0;
  }
}
