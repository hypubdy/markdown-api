import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";

// Mock adapter Clerk cho Hono trước khi app được nạp.
vi.mock("@hono/clerk-auth", async () => {
  const { createMockedClerkModule } = await import("./support/mock-clerk");
  return createMockedClerkModule();
});

describe("Clerk auth + tu dong bo user (mock Clerk)", () => {
  let app: ReturnType<(typeof import("../src/app"))["createApp"]>;

  beforeAll(async () => {
    expect(env.AUTH_PROVIDER).toBe("clerk");
    const { createApp } = await import("../src/app");
    app = createApp();
  });

  // Mac dinh CHUA co ai dang nhap truoc moi test.
  beforeEach(async () => {
    const { clearMockSessionUser } = await import("./support/mock-clerk");
    clearMockSessionUser();
  });

  it("khong co session token -> 401 (Clerk tu choi)", async () => {
    const res = await app.request("/api/v1/users/me");
    expect(res.status).toBe(401);
  });

  it("session hop le (user CHUA co trong DB) -> dong bo tao user + GET /users/me 200", async () => {
    const { setMockSessionUser } = await import("./support/mock-clerk");
    setMockSessionUser({
      id: "user_2clerkMock00000000000000001",
      firstName: "Ngoc",
      lastName: "Tran",
      primaryEmailAddressId: "idp_email_1",
      emailAddresses: [{ id: "idp_email_1", emailAddress: "clerk.user@example.com" }],
      publicMetadata: {},
    });

    const res = await app.request("/api/v1/users/me", { headers: { Authorization: "Bearer mocked-clerk-session" } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.email).toBe("clerk.user@example.com");
    expect(body.data.name).toBe("Ngoc Tran");
    expect(body.data.role).toBe("user");
    expect(body.data.passwordHash).toBeUndefined();
  });

  it("user dong bo da co trong DB -> dung user cu, KHONG nhan doi", async () => {
    const { setMockSessionUser } = await import("./support/mock-clerk");
    setMockSessionUser({
      id: "user_2clerkMock00000000000000001",
      firstName: "Ngoc",
      lastName: "Tran",
      primaryEmailAddressId: "idp_email_1",
      emailAddresses: [{ id: "idp_email_1", emailAddress: "clerk.user@example.com" }],
      publicMetadata: {},
    });

    const res = await app.request("/api/v1/users/me", { headers: { Authorization: "Bearer mocked-clerk-session" } });

    expect(res.status).toBe(200);
    expect((await res.json()).data.email).toBe("clerk.user@example.com");
  });

  it("role admin tu publicMetadata duoc dong bo sang DB", async () => {
    const { setMockSessionUser } = await import("./support/mock-clerk");
    setMockSessionUser({
      id: "user_2clerkMock00000000000000002",
      firstName: "Quan",
      lastName: "Tri",
      primaryEmailAddressId: "idp_email_admin",
      emailAddresses: [{ id: "idp_email_admin", emailAddress: "clerk.admin@example.com" }],
      publicMetadata: { role: "admin" },
    });

    const res = await app.request("/api/v1/users/me", { headers: { Authorization: "Bearer mocked-clerk-session-admin" } });

    expect(res.status).toBe(200);
    expect((await res.json()).data.role).toBe("admin");
  });
});
