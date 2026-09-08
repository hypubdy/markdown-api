import bcrypt from "bcryptjs";
import type {
  CreateUserInput,
  SafeUser,
  User,
  UserRole,
} from "../types/index";

/**
 * GIAO DIỆN CHUNG cho tầng truy xuất user.
 * Các action chỉ phụ thuộc interface này — không biết SQLite hay PostgreSQL,
 * nên dễ mock và dễ đổi driver (xem factory ở src/data/index.ts).
 */

/** Một dòng dữ liệu thô trả về từ DB (tên cột dạng snake_case) */
export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface UserRepository {
  /** Tạo bảng nếu chưa tồn tại (gọi 1 lần lúc khởi động) */
  init(): Promise<void>;
  /** Tạo user mới (hash mật khẩu, tự sinh id) */
  create(input: CreateUserInput): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  findAll(): Promise<User[]>;
  /** Đổi role, trả user mới hoặc null nếu không tồn tại */
  updateRole(id: string, role: UserRole): Promise<User | null>;
  deleteById(id: string): Promise<boolean>;
}

/** Helper dùng chung cho mọi driver */

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/** Loại bỏ passwordHash trước khi trả user về client */
export function toSafeUser(user: User): SafeUser {
  const { passwordHash: _ignored, ...safe } = user;
  return safe;
}

/** Chuẩn hoá timestamp từ DB về ISO string (pg trả Date, sqlite trả TEXT) */
function normalizeTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Map một dòng dữ liệu thô của DB thành kiểu User của ứng dụng */
export function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role as UserRole,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

/** Nội dung bảng users dùng chung cho cả 2 driver (SQL gần tương đương) */
export const CREATE_USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  )
`;
