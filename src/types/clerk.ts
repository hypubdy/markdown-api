export type ClerkUserRole = "user" | "admin";

/**
 * Hồ sơ Clerk thu gọn — chỉ giữ các field middleware cần:
 * email chính, tên hiển thị và publicMetadata (nơi ta đặt role).
 * Đúng cấu trúc object trả về từ clerkClient.users.getUser(userId).
 */
export interface ClerkUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddressId: string | null;
  emailAddresses: Array<{ id: string; emailAddress: string }>;
  publicMetadata: { role?: ClerkUserRole };
}