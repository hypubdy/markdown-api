import { getUserRepository } from "../src/data/index";
import type { TestCase } from "./support/case-runner";
import { runCaseSuite } from "./support/run-case-suite";
import { signInAs } from "./support/helpers";

/**
 * MOCK PHIÊN ĐÃ ĐĂNG NHẬP — bảng test case được khai báo NGAY TRONG file này
 * rồi chạy bằng runCaseSuite(). Token được ký giả bằng signInAs() (ĐÚNG JWT_SECRET
 * của app) trong prepare() — vẫn qua jwt.verify() của middleware authenticate thật.
 */

const mockTokenCases: TestCase[] = [
  {
    name: "token tự ký (user không tồn tại trong store) vẫn qua authenticate → GET /users 200",
    method: "get",
    path: "/users",
    token: "$userToken",
    expectedStatus: 200,
  },
  {
    name: "token tự ký role 'user' → DELETE người khác bị authorize chặn 403",
    method: "delete",
    path: "/users/$adminId",
    token: "$userToken",
    expectedStatus: 403,
  },
  {
    name: "token tự ký role 'admin' → DELETE user khác thành công 204 (không cần login admin thật)",
    method: "delete",
    path: "/users/$victimId",
    token: "$adminToken",
    expectedStatus: 204,
  },
  {
    name: "token bị sửa chữ ký (tương đương sai secret/hết hạn) → authenticate trả 401",
    method: "get",
    path: "/users",
    token: "$badToken",
    expectedStatus: 401,
  },
  {
    name: "GET /users/me với token có id KHÔNG có trong store → 404 (action vẫn tra cứu store)",
    method: "get",
    path: "/users/me",
    token: "$ghostToken",
    expectedStatus: 404,
  },
  {
    name: "tạo user thật trong store rồi ký token đúng id của nó → GET /users/me 200",
    method: "get",
    path: "/users/me",
    token: "$realUserToken",
    expectedStatus: 200,
    expect: [{ path: "data.email", equals: "$realUserEmail" }],
  },
];

runCaseSuite(mockTokenCases, {
  label: "Mock token đã đăng nhập (ký giả JWT, không gọi login/register)",
  prepare: async () => {
    const users = await getUserRepository(); // SQLite — DB sạch của worker này

    const admin = await users.findByEmail("admin@example.com");
    if (!admin) throw new Error("Chưa có admin — seed phải chạy trước prepare");

    // Fixture thật trong DB (action DELETE/GET /me vẫn tra cứu theo id)
    const victim = await users.create({
      name: "Nạn Nhân",
      email: `victim-${Date.now()}@example.com`,
      password: "matkhau123",
    });
    const realUser = await users.create({
      name: "User Thật",
      email: `real-${Date.now()}@example.com`,
      password: "matkhau123",
    });

    // Token giả — không cần biết mật khẩu của ai
    const validToken = signInAs();
    const adminToken = signInAs({ role: "admin" });

    // Làm hỏng chữ ký để giả lập token sai secret / hết hạn
    const badToken =
      validToken.slice(0, -1) + (validToken.endsWith("a") ? "b" : "a");

    return {
      userToken: validToken, // role user, id ngẫu nhiên (không tồn tại trong store)
      adminToken, // role admin tuỳ chọn
      badToken,
      ghostToken: signInAs(), // id không có trong store
      realUserToken: signInAs({
        id: realUser.id,
        email: realUser.email,
        role: "user",
      }),
      realUserEmail: realUser.email,
      adminId: admin.id,
      victimId: victim.id,
    };
  },
});
