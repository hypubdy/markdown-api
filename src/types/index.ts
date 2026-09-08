export type UserRole = "admin" | "user";

/** Bản ghi user lưu trong store (có passwordHash — không bao giờ trả ra client) */
export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

/** User an toàn khi gửi ra ngoài (đã bỏ passwordHash) */
export type SafeUser = Omit<User, "passwordHash">;

/** Payload đặt trong JWT và gắn vào req.user bởi middleware authenticate */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

/** Dữ liệu cần thiết để tạo user mới */
export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
}
