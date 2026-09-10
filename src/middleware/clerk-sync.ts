import type { UserRepository } from "../data/user.repository";
import type { ClerkUser } from "../types/clerk";
import type { User } from "../types/index";
import { ApiError } from "../utils/ApiError";

export function getPrimaryEmail(clerkUser: ClerkUser): string | null {
  return (
    clerkUser.emailAddresses.find(
      (item) => item.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ?? null
  );
}

export function clerkDisplayName(clerkUser: ClerkUser): string {
  return (
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
    (getPrimaryEmail(clerkUser)?.split("@")[0] ?? "User")
  );
}

export function roleFromMetadata(metadata: ClerkUser["publicMetadata"]): "user" | "admin" {
  return metadata?.role === "admin" ? "admin" : "user";
}

export async function syncUserFromClerkUser(clerkUser: ClerkUser, users: UserRepository, clerkUserId: string): Promise<User> {
  const primaryEmail = getPrimaryEmail(clerkUser);
  if (!primaryEmail) {
    throw ApiError.unauthorized("Tai khoan Clerk chua co email chinh");
  }
  const existing = await users.findByEmail(primaryEmail);
  if (existing) return (await users.setClerkUserId(existing.id, clerkUserId)) ?? existing;
  const created = await users.create({
    name: clerkDisplayName(clerkUser),
    email: primaryEmail,
    password: Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, "0")).join(""),
    role: roleFromMetadata(clerkUser.publicMetadata),
  });
  return (await users.setClerkUserId(created.id, clerkUserId)) ?? created;
}