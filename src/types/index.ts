export type UserRole = "admin" | "user";

/** Bản ghi user lưu trong store (có passwordHash — không bao giờ trả ra client) */
export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  clerkUserId?: string;
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

// ─────────────────────────────────────────────────────────────
// Notes / Tags (BACKEND-PLAN.md mục 2) — giữ nguyên mọi kiểu cũ
// ─────────────────────────────────────────────────────────────

export type NoteStatus = "draft" | "published";

/** Bản ghi note ở tầng ứng dụng (camelCase, timestamp đã chuẩn hoá ISO string) */
export interface Note {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  status: NoteStatus;
  /** null = còn sống; có giá trị = đang ở thùng rác */
  deletedAt: string | null;
  /** null = chưa public share */
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Dữ liệu tạo note mới */
export interface CreateNoteInput {
  ownerId: string;
  title: string;
  content?: string; // thiếu → lưu ''
  status?: NoteStatus; // thiếu → 'draft'
}

/** Bộ lọc + phân trang cho NoteRepository.list() */
export interface NoteListFilters {
  ownerId: string;
  q?: string; // tìm trong title/content
  status?: NoteStatus;
  tag?: string; // tên tag chính xác
  page: number; // ≥ 1
  limit: number; // 1..100
}

/** Kết quả list() — total không phụ thuộc page/limit */
export interface NoteListResult {
  items: Note[];
  total: number;
}

/** Dữ liệu sửa một phần note */
export interface UpdateNoteInput {
  title?: string;
  content?: string;
  status?: NoteStatus;
}

/** Một tag kèm số note đang sống mang nó */
export interface TagCount {
  name: string;
  count: number;
}
