import type { TestCase } from "./support/case-runner";
import { runCaseSuite } from "./support/run-case-suite";

/**
 * INTEGRATION TEST — module notes/tags/public-share (BACKEND-PLAN.md mục 3).
 * Bảng test case (object) khai báo NGAY TRONG FILE rồi chạy bằng runCaseSuite().
 * Engine dùng chung: tests/support/case-runner.ts — CHỈ dùng các rule:
 * equals / exists / notExists / isUuid / containsField / includesItem / length.
 *
 * KHÔNG dùng prepare(): user + token lấy từ case POST /auth/register đầu bảng.
 * Trạng thái RED hiện tại: module notes chưa mount → các case notes/tags/share
 * fail do route không tồn tại (404), case auth (register) pass.
 *
 * Lưu ý q=hoc: search chỉ so khớp title/content không phân biệt hoa thường (LOWER),
 * KHÔNG bỏ dấu tiếng Việt — nên content note 1 cố tình chứa chuỗi ASCII "hoc"
 * ("tự hoc Markdown") để case GET /notes?q=hoc khớp được theo đúng hợp đồng.
 */

const notesCases: TestCase[] = [
  // ── đăng ký 2 user (auth pass cả khi module notes chưa có) ─────────
  {
    name: "POST /auth/register user A → 201, lưu token/id/email",
    method: "post",
    path: "/auth/register",
    body: { name: "User A", email: "$uniqueEmail", password: "matkhau123" },
    expectedStatus: 201,
    expect: [
      { path: "data.token", exists: true },
      { path: "data.user.id", isUuid: true },
      { path: "data.user.role", equals: "user" },
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
    expect: [{ path: "data.token", exists: true }],
    save: {
      userBToken: "data.token",
      userBId: "data.user.id",
      userBEmail: "data.user.email",
    },
  },

  // ── tạo + danh sách note ───────────────────────────────────────────
  {
    name: "POST /notes (A) tạo note 'Học Markdown' draft + 2 tag → 201, note đầy đủ",
    method: "post",
    path: "/notes",
    token: "$userAToken",
    body: {
      title: "Học Markdown",
      content:
        "Hướng dẫn tự hoc Markdown từ cơ bản:\n\n- `#` tạo tiêu đề\n- `**in đậm**`, `*nghiêng*`\n- `-` tạo danh sách\n\nTừ khoá: markdown, hoc.",
      status: "draft",
      tagNames: ["markdown", "hoc"],
    },
    expectedStatus: 201,
    expect: [
      { path: "data.id", isUuid: true },
      { path: "data.ownerId", equals: "$userAId" },
      { path: "data.title", equals: "Học Markdown" },
      { path: "data.content", exists: true },
      { path: "data.status", equals: "draft" },
      { path: "data.tags", length: 2 },
      { path: "data.shareToken", equals: null },
      { path: "data.deletedAt", equals: null },
    ],
    save: { noteId: "data.id" },
  },
  {
    name: "GET /notes không có token → 401",
    method: "get",
    path: "/notes",
    expectedStatus: 401,
  },
  {
    name: "GET /notes (A) → 200, đúng 1 note vừa tạo",
    method: "get",
    path: "/notes",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [
      { path: "data", length: 1 },
      { path: "data", includesItem: { field: "id", equals: "$noteId" } },
    ],
  },
  {
    name: "GET /notes (B) → 200, 0 note (cô lập chủ sở hữu)",
    method: "get",
    path: "/notes",
    token: "$userBToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 0 }],
  },
  {
    name: "GET /notes/$noteId (A) → 200, chi tiết đầy đủ kèm content",
    method: "get",
    path: "/notes/$noteId",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [
      { path: "data.title", equals: "Học Markdown" },
      { path: "data.content", exists: true },
      { path: "data.tags", length: 2 },
    ],
  },
  {
    name: "GET /notes/$noteId (B) → 404 (note của user khác)",
    method: "get",
    path: "/notes/$noteId",
    token: "$userBToken",
    expectedStatus: 404,
  },
  {
    name: "GET /notes/$noteId/raw (A) → 200 (nội dung markdown, chỉ assert status)",
    method: "get",
    path: "/notes/$noteId/raw",
    token: "$userAToken",
    expectedStatus: 200,
  },

  // ── search / lọc / tag ─────────────────────────────────────────────
  {
    name: "GET /notes?q=hoc (A) → 200, tìm thấy note (khớp content không hoa thường)",
    method: "get",
    path: "/notes?q=hoc",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 1 }],
  },
  {
    name: "GET /notes?status=draft (A) → 200, đúng 1 note draft",
    method: "get",
    path: "/notes?status=draft",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 1 }],
  },
  {
    name: "GET /notes?tag=markdown (A) → 200, đúng 1 note mang tag markdown",
    method: "get",
    path: "/notes?tag=markdown",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 1 }],
  },
  {
    name: "GET /tags (A) → 200, 2 tag markdown + hoc",
    method: "get",
    path: "/tags",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [
      { path: "data", length: 2 },
      { path: "data", includesItem: { field: "name", equals: "markdown" } },
      { path: "data", includesItem: { field: "name", equals: "hoc" } },
    ],
  },

  // ── note 2 + đếm lại (tag không nhân đôi) ─────────────────────────
  {
    name: "POST /notes (A) tạo note 2 'Nhật ký' tag markdown → 201, lưu note2Id",
    method: "post",
    path: "/notes",
    token: "$userAToken",
    body: { title: "Nhật ký", tagNames: ["markdown"] },
    expectedStatus: 201,
    save: { note2Id: "data.id" },
  },
  {
    name: "GET /notes (A) → 200, đúng 2 note",
    method: "get",
    path: "/notes",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 2 }],
  },
  {
    name: "GET /tags (A) → 200, vẫn 2 tag (markdown không nhân đôi dù 2 note mang)",
    method: "get",
    path: "/tags",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 2 }],
  },
  {
    name: "GET /notes?tag=markdown (A) → 200, đúng 2 note mang tag markdown",
    method: "get",
    path: "/notes?tag=markdown",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 2 }],
  },

  // ── public share: bật → xem → thu hồi → xem lại 404 ───────────────
  {
    name: "POST /notes/$noteId/share (A) → 200, có shareToken (lưu để dùng sau)",
    method: "post",
    path: "/notes/$noteId/share",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data.shareToken", exists: true }],
    save: { shareToken: "data.shareToken" },
  },
  {
    name: "GET /public/notes/$shareToken (không token) → 200, xem note công khai",
    method: "get",
    path: "/public/notes/$shareToken",
    expectedStatus: 200,
    expect: [{ path: "data.title", equals: "Học Markdown" }],
  },
  {
    name: "GET /public/notes/token-sai-0000 (không token) → 404",
    method: "get",
    path: "/public/notes/token-sai-0000",
    expectedStatus: 404,
  },
  {
    name: "DELETE /notes/$noteId/share (A) → 200, shareToken về null (thu hồi)",
    method: "delete",
    path: "/notes/$noteId/share",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data.shareToken", equals: null }],
  },
  {
    name: "GET /public/notes/$shareToken sau khi thu hồi (không token) → 404",
    method: "get",
    path: "/public/notes/$shareToken",
    expectedStatus: 404,
  },

  // ── sửa note + validate ────────────────────────────────────────────
  {
    name: "PATCH /notes/$noteId (A) sửa title + thay tag → 200, title mới",
    method: "patch",
    path: "/notes/$noteId",
    token: "$userAToken",
    body: { title: "Học Markdown nâng cao", tagNames: ["markdown"] },
    expectedStatus: 200,
    expect: [{ path: "data.title", equals: "Học Markdown nâng cao" }],
  },
  {
    name: "PATCH /notes/$noteId (B) sửa note của A → 404",
    method: "patch",
    path: "/notes/$noteId",
    token: "$userBToken",
    body: { title: "x" },
    expectedStatus: 404,
  },
  {
    name: "POST /notes thiếu title → 400 kèm chi tiết field body.title",
    method: "post",
    path: "/notes",
    token: "$userAToken",
    body: {},
    expectedStatus: 400,
    expect: [{ path: "details", containsField: "body.title" }],
  },
  {
    name: "GET /notes/khong-phai-uuid (A) → 400 (id sai định dạng uuid)",
    method: "get",
    path: "/notes/khong-phai-uuid",
    token: "$userAToken",
    expectedStatus: 400,
  },

  // ── soft-delete → thùng rác → restore ──────────────────────────────
  {
    name: "DELETE /notes/$noteId (A) → 204 (soft-delete)",
    method: "delete",
    path: "/notes/$noteId",
    token: "$userAToken",
    expectedStatus: 204,
  },
  {
    name: "GET /notes (A) → 200, chỉ còn note 2",
    method: "get",
    path: "/notes",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 1 }],
  },
  {
    name: "GET /notes/$noteId (A) sau soft-delete → 404",
    method: "get",
    path: "/notes/$noteId",
    token: "$userAToken",
    expectedStatus: 404,
  },
  {
    name: "GET /notes/trash (A) → 200, thùng rác có đúng note đã xoá",
    method: "get",
    path: "/notes/trash",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [
      { path: "data", length: 1 },
      { path: "data", includesItem: { field: "id", equals: "$noteId" } },
    ],
  },
  {
    name: "POST /notes/trash/$noteId/restore (A) → 200, note sống lại (deletedAt null)",
    method: "post",
    path: "/notes/trash/$noteId/restore",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data.deletedAt", equals: null }],
  },
  {
    name: "GET /notes (A) sau restore → 200, đủ 2 note",
    method: "get",
    path: "/notes",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 2 }],
  },

  // ── xoá mềm lần 2 rồi xoá hẳn qua thùng rác ────────────────────────
  {
    name: "DELETE /notes/$noteId (A) → 204 (soft-delete lần 2)",
    method: "delete",
    path: "/notes/$noteId",
    token: "$userAToken",
    expectedStatus: 204,
  },
  {
    name: "DELETE /notes/trash/$noteId (A) → 204 (xoá hẳn khỏi thùng rác)",
    method: "delete",
    path: "/notes/trash/$noteId",
    token: "$userAToken",
    expectedStatus: 204,
  },
  {
    name: "GET /notes/trash (A) sau khi xoá hẳn → 200, thùng rác rỗng",
    method: "get",
    path: "/notes/trash",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 0 }],
  },
  {
    name: "GET /notes?tag=markdown (A) → 200, chỉ còn note 2 (note 1 đã xoá hẳn)",
    method: "get",
    path: "/notes?tag=markdown",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 1 }],
  },

  // ── xoá mềm note 2 → tag không còn note sống → /tags rỗng ──────────
  {
    name: "DELETE /notes/$note2Id (A) → 204 (soft-delete note 2)",
    method: "delete",
    path: "/notes/$note2Id",
    token: "$userAToken",
    expectedStatus: 204,
  },
  {
    name: "GET /tags (A) → 200, rỗng (markdown/hoc không còn note SỐNG nào mang)",
    method: "get",
    path: "/tags",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 0 }],
  },

  // ── slice tag-sở-hữu + validate (Red Agent Phase 4) ────────────────
  {
    name: "POST /notes (A) tạo note 'Slice Tag' tag taga+tagb → 201, lưu note3Id",
    method: "post",
    path: "/notes",
    token: "$userAToken",
    body: { title: "Slice Tag", content: "abc", tagNames: ["taga", "tagb"] },
    expectedStatus: 201,
    expect: [{ path: "data.id", isUuid: true }],
    save: { note3Id: "data.id" },
  },
  {
    name: "GET /tags (A) → 200, có tag taga (không assert tổng length)",
    method: "get",
    path: "/tags",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", includesItem: { field: "name", equals: "taga" } }],
  },
  {
    name: "DELETE /tags/taga (A) → 200 (xoá tag thuộc mình)",
    method: "delete",
    path: "/tags/taga",
    token: "$userAToken",
    expectedStatus: 200,
  },
  {
    name: "GET /notes?tag=taga (A) → 200, 0 note (đã gỡ tag khỏi mọi note sống)",
    method: "get",
    path: "/notes?tag=taga",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data", length: 0 }],
  },
  {
    name: "GET /notes/$note3Id (A) → 200, note3 chỉ còn 1 tag tagb",
    method: "get",
    path: "/notes/$note3Id",
    token: "$userAToken",
    expectedStatus: 200,
    expect: [{ path: "data.tags", length: 1 }],
  },
  {
    name: "DELETE /tags/tagb (B) → 404 (tag của A — B không nhìn thấy)",
    method: "delete",
    path: "/tags/tagb",
    token: "$userBToken",
    expectedStatus: 404,
  },
  {
    name: "DELETE /tags/khong-co (A) → 404 (tag không tồn tại)",
    method: "delete",
    path: "/tags/khong-co",
    token: "$userAToken",
    expectedStatus: 404,
  },
  {
    name: "POST /notes (A) title rỗng → 400 kèm chi tiết field body.title",
    method: "post",
    path: "/notes",
    token: "$userAToken",
    body: { title: "", content: "x" },
    expectedStatus: 400,
    expect: [{ path: "details", containsField: "body.title" }],
  },
  {
    name: "GET /notes?limit=abc (A) → 400 (limit không coerce được thành số)",
    method: "get",
    path: "/notes?limit=abc",
    token: "$userAToken",
    expectedStatus: 400,
  },
  {
    name: "POST /notes/trash/khong-phai-uuid/restore (A) → 400 (params sai uuid)",
    method: "post",
    path: "/notes/trash/khong-phai-uuid/restore",
    token: "$userAToken",
    expectedStatus: 400,
  },
  {
    name: "DELETE /notes/$note3Id (A) → 204 (soft-delete dọn note3)",
    method: "delete",
    path: "/notes/$note3Id",
    token: "$userAToken",
    expectedStatus: 204,
  },
  {
    name: "DELETE /notes/trash/$note3Id (A) → 204 (xoá hẳn, dọn sạch)",
    method: "delete",
    path: "/notes/trash/$note3Id",
    token: "$userAToken",
    expectedStatus: 204,
  },
];

runCaseSuite(notesCases, {
  label: "API /api/v1 — notes & tags & public share",
});
