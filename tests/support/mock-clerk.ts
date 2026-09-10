import type { ClerkUser } from "../../src/types/clerk";
import { vi } from "vitest";

const snapshot: { user: ClerkUser | null } = { user: null };
export function clearMockSessionUser(): void { snapshot.user = null; }
export function setMockSessionUser(user: ClerkUser): void { snapshot.user = user; }

export function createMockedClerkModule() {
  const client = {
    users: {
      getUser: vi.fn(async (userId: string) => {
        if (snapshot.user?.id !== userId) throw Object.assign(new Error("Not found"), { status: 404 });
        return snapshot.user;
      }),
    },
  };
  return {
    clerkMiddleware: () => async (c: { set(key: string, value: unknown): void }, next: () => Promise<void>) => {
      c.set("clerk", client);
      await next();
    },
    getAuth: () => ({ userId: snapshot.user?.id ?? null }),
  };
}
