import type { TestCase } from "./support/case-runner";
import { runCaseSuite } from "./support/run-case-suite";

/**
 * INTEGRATION TEST — bảng test case (object) được khai báo NGAY TRONG file này
 * rồi chạy luôn bằng runCaseSuite(). Engine dùng chung: tests/support/case-runner.ts.
 */

const appCases: TestCase[] = [
  // ── hệ thống ─────────────────────────────────────────────────────
  {
    name: "GET /health trả 200 với trạng thái ok",
    method: "get",
    path: "/health",
    expectedStatus: 200,
    expect: [
      { path: "success", equals: true },
      { path: "data.status", equals: "ok" },
    ],
  },

  // ── đăng nhập ────────────────────────────────────────────────────
  {
    name: "POST /auth/login đúng → 200, lưu token admin",
    method: "post",
    path: "/auth/login",
    body: { email: "admin@example.com", password: "admin123" },
    expectedStatus: 200,
    expect: [
      { path: "data.token", exists: true },
      { path: "data.user.id", isUuid: true },
      { path: "data.user.email", equals: "admin@example.com" },
      { path: "data.user.passwordHash", notExists: true },
    ],
    save: {
      adminToken: "data.token",
      adminId: "data.user.id",
    },
  },
  {
    name: "POST /auth/login sai mật khẩu → 401",
    method: "post",
    path: "/auth/login",
    body: { email: "admin@example.com", password: "sai-mat-khau" },
    expectedStatus: 401,
    expect: [{ path: "message", equals: "Email hoặc mật khẩu không đúng" }],
  },
  {
    name: "POST /auth/login email không tồn tại → 401 (cùng message)",
    method: "post",
    path: "/auth/login",
    body: { email: "khong-ton-tai@example.com", password: "matkhau123" },
    expectedStatus: 401,
    expect: [{ path: "message", equals: "Email hoặc mật khẩu không đúng" }],
  },
  {
    name: "POST /auth/login thiếu password → 400 (validate bắt trước action)",
    method: "post",
    path: "/auth/login",
    body: { email: "admin@example.com" },
    expectedStatus: 400,
    expect: [{ path: "details", containsField: "body.password" }],
  },

  // ── đăng ký ──────────────────────────────────────────────────────
  {
    name: "POST /auth/register user A → 201, lưu token/id/email",
    method: "post",
    path: "/auth/register",
    body: { name: "User A", email: "$uniqueEmail", password: "matkhau123" },
    expectedStatus: 201,
    expect: [
      { path: "data.token", exists: true },
      { path: "data.user.role", equals: "user" },
      { path: "data.user.passwordHash", notExists: true },
    ],
    save: {
      userAToken: "data.token",
      userAId: "data.user.id",
      userAEmail: "data.user.email",
    },
  },
  {
    name: "POST /auth/register user B → 201, lưu token/id/email",
    method: "post",
    path: "/auth/register",
    body: { name: "User B", email: "$uniqueEmail", password: "matkhau123" },
    expectedStatus: 201,
    save: {
      userBToken: "data.token",
      userBId: "data.user.id",
      userBEmail: "data.user.email",
    },
  },

  // ── user info: stats / lọc / tìm / profile ───────────────────────
  {
    name: "GET /users/stats (admin) → 200, đếm đúng (admin + userA + userB)",
    method: "get",
    path: "/users/stats",
    token: "$adminToken",
    expectedStatus: 200,
    expect: [
      { path: "data.total", equals: 3 },
      { path: "data.admins", equals: 1 },
      { path: "data.users", equals: 2 },
    ],
  },
  {
    name: "GET /users/stats bằng user thường → 403 (chỉ admin)",
    method: "get",
    path: "/users/stats",
    token: "$userAToken",
    expectedStatus: 403,
  },
  {
    name: "GET /users?role=admin → 200, đúng 1 user admin",
    method: "get",
    path: "/users?role=admin",
    token: "$adminToken",
    expectedStatus: 200,
    expect: [
      { path: "data", length: 1 },
      {
        path: "data",
        includesItem: { field: "email", equals: "admin@example.com" },
      },
    ],
  },
  {
    name: "GET /users?role=user → 200, đúng 2 user thường",
    method: "get",
    path: "/users?role=user",
    token: "$adminToken",
    expectedStatus: 200,
    expect: [
      { path: "data", length: 2 },
      { path: "data", includesItem: { field: "email", equals: "$userAEmail" } },
    ],
  },
  {
    name: "GET /users?q=user+b → 200, tìm theo tên ra đúng user B",
    method: "get",
    path: "/users?q=user+b",
    token: "$adminToken",
    expectedStatus: 200,
    expect: [
      { path: "data", length: 1 },
      { path: "data", includesItem: { field: "email", equals: "$userBEmail" } },
    ],
  },
  {
    name: "GET /users?role=super → 400 (validate query)",
    method: "get",
    path: "/users?role=super",
    token: "$adminToken",
    expectedStatus: 400,
  },
  {
    name: "GET /users/:userBId/profile → 200, hồ sơ công khai gọn nhẹ (không lộ email/hash)",
    method: "get",
    path: "/users/$userBId/profile",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [
      { path: "data.id", isUuid: true },
      { path: "data.name", equals: "User B" },
      { path: "data.role", equals: "user" },
      { path: "data.email", notExists: true },
      { path: "data.passwordHash", notExists: true },
    ],
  },
  {
    name: "GET /users/:id/profile không tồn tại → 404",
    method: "get",
    path: "/users/00000000-0000-4000-8000-000000000000/profile",
    token: "$adminToken",
    expectedStatus: 404,
  },
  {
    name: "POST /auth/register payload sai → 400 kèm chi tiết field lỗi",
    method: "post",
    path: "/auth/register",
    body: { name: "A", email: "sai-email", password: "1" },
    expectedStatus: 400,
    expect: [
      { path: "details", containsField: "body.name" },
      { path: "details", containsField: "body.email" },
      { path: "details", containsField: "body.password" },
    ],
  },
  {
    name: "POST /auth/register trùng email admin → 409",
    method: "post",
    path: "/auth/register",
    body: {
      name: "Trùng Email",
      email: "admin@example.com",
      password: "matkhau123",
    },
    expectedStatus: 409,
  },

  // ── module user: bảo vệ route ────────────────────────────────────
  {
    name: "GET /users không có token → 401",
    method: "get",
    path: "/users",
    expectedStatus: 401,
  },
  {
    name: "GET /users token sai → 401",
    method: "get",
    path: "/users",
    token: "$tokenSai",
    expectedStatus: 401,
  },

  // ── module user: quyền admin ─────────────────────────────────────
  {
    name: "GET /users (admin) → 200, chứa admin và user A",
    method: "get",
    path: "/users",
    token: "$adminToken",
    expectedStatus: 200,
    expect: [
      {
        path: "data",
        includesItem: { field: "email", equals: "admin@example.com" },
      },
      { path: "data", includesItem: { field: "email", equals: "$userAEmail" } },
    ],
  },
  {
    name: "GET /users/me (user A) → 200, đúng user của token",
    method: "get",
    path: "/users/me",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data.email", equals: "$userAEmail" }],
  },
  {
    name: "GET /users/khong-phai-uuid → 400 (validate params)",
    method: "get",
    path: "/users/khong-phai-uuid",
    token: "$adminToken",
    expectedStatus: 400,
  },
  {
    name: "GET /users/:id không tồn tại → 404",
    method: "get",
    path: "/users/00000000-0000-4000-8000-000000000000",
    token: "$adminToken",
    expectedStatus: 404,
  },
  {
    name: "GET /users/:userBId (user A) → 200, đúng user B",
    method: "get",
    path: "/users/$userBId",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data.email", equals: "$userBEmail" }],
  },

  // ── module user: phân quyền authorize ────────────────────────────
  {
    name: "DELETE /users/:userBId bằng user A → 403 (không phải admin)",
    method: "delete",
    path: "/users/$userBId",
    token: "$userAToken",
    expectedStatus: 403,
  },
  {
    name: "PATCH /users/:userBId/role bằng user A → 403",
    method: "patch",
    path: "/users/$userBId/role",
    token: "$userAToken",
    body: { role: "admin" },
    expectedStatus: 403,
  },
  {
    name: "PATCH /users/:userBId/role bằng admin → 200, role thành admin",
    method: "patch",
    path: "/users/$userBId/role",
    token: "$adminToken",
    body: { role: "admin" },
    expectedStatus: 200,
    expect: [{ path: "data.role", equals: "admin" }],
  },
  {
    name: "DELETE /users/:adminId bằng admin (tự xoá) → 400 (check trong action)",
    method: "delete",
    path: "/users/$adminId",
    token: "$adminToken",
    expectedStatus: 400,
    expect: [
      {
        path: "message",
        equals: "Không thể tự xoá tài khoản của chính mình",
      },
    ],
  },
  {
    name: "DELETE /users/:userBId bằng admin → 204, sau đó GET → 404",
    method: "delete",
    path: "/users/$userBId",
    token: "$adminToken",
    expectedStatus: 204,
  },
  {
    name: "GET /users/:userBId sau khi xoá → 404",
    method: "get",
    path: "/users/$userBId",
    token: "$adminToken",
    expectedStatus: 404,
  },

  // ── 404 chung ────────────────────────────────────────────────────
  {
    name: "GET route không tồn tại → 404 JSON chuẩn",
    method: "get",
    path: "/khong-ton-tai",
    expectedStatus: 404,
    expect: [{ path: "success", equals: false }],
  },
];

runCaseSuite(appCases, {
  label: "API /api/v1 — auth & user",
});
