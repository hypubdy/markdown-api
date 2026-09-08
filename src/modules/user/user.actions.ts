import type { Request, Response } from "express";
import { getUserRepository } from "../../data/index";
import { toSafeUser } from "../../data/user.repository";
import type { ListUsersQuery, UpdateRoleBody } from "./user.schemas";
import { ApiError } from "../../utils/ApiError";

/**
 * ACTIONS của module user — logic thuần, không biết gì về express Router.
 * Truy xuất dữ liệu qua UserRepository (interface chung).
 * Middleware authenticate (đặt ở cấp module) đảm bảo req.user luôn có sẵn ở đây.
 */

/** GET /users — danh sách user, lọc theo ?role= và/hoặc ?q= (tên/email) */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const { role, q } = req.query as ListUsersQuery;

  let users = await (await getUserRepository()).findAll();

  if (role) {
    users = users.filter((user) => user.role === role);
  }
  if (q) {
    const needle = q.toLowerCase();
    users = users.filter(
      (user) =>
        user.name.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle),
    );
  }

  res.json({
    success: true,
    data: users.map(toSafeUser),
  });
}

/** GET /users/stats — thống kê số lượng user (chỉ admin) */
export async function getStats(_req: Request, res: Response): Promise<void> {
  const users = await (await getUserRepository()).findAll();

  const stats = {
    total: users.length,
    admins: users.filter((u) => u.role === "admin").length,
    users: users.filter((u) => u.role === "user").length,
  };

  res.json({ success: true, data: stats });
}

/** GET /users/:id/profile — hồ sơ công khai của user (bộ trường gọn nhẹ) */
export async function getUserProfile(
  req: Request,
  res: Response,
): Promise<void> {
  const user = await (await getUserRepository()).findById(req.params.id);
  if (!user) {
    throw ApiError.notFound("Không tìm thấy người dùng");
  }

  res.json({
    success: true,
    data: {
      id: user.id,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
}

/** GET /users/me — thông tin user hiện tại (lấy từ JWT) */
export async function getMe(req: Request, res: Response): Promise<void> {
  const user = await (await getUserRepository()).findById(req.user!.id);
  if (!user) {
    throw ApiError.notFound("Không tìm thấy người dùng của token này");
  }
  res.json({ success: true, data: toSafeUser(user) });
}

/** GET /users/:id — chi tiết user theo id */
export async function getUserById(req: Request, res: Response): Promise<void> {
  const user = await (await getUserRepository()).findById(req.params.id);
  if (!user) {
    throw ApiError.notFound("Không tìm thấy người dùng");
  }
  res.json({ success: true, data: toSafeUser(user) });
}

/** PATCH /users/:id/role — đổi role (chỉ admin) */
export async function updateRole(req: Request, res: Response): Promise<void> {
  const { role } = req.body as UpdateRoleBody;

  const updated = await (await getUserRepository()).updateRole(
    req.params.id,
    role,
  );
  if (!updated) {
    throw ApiError.notFound("Không tìm thấy người dùng");
  }

  res.json({
    success: true,
    message: "Đã cập nhật role",
    data: toSafeUser(updated),
  });
}

/** DELETE /users/:id — xoá user (chỉ admin, không xoá chính mình) */
export async function deleteUser(req: Request, res: Response): Promise<void> {
  const id = req.params.id;

  if (req.user!.id === id) {
    throw ApiError.badRequest("Không thể tự xoá tài khoản của chính mình");
  }

  const deleted = await (await getUserRepository()).deleteById(id);
  if (!deleted) {
    throw ApiError.notFound("Không tìm thấy người dùng");
  }

  res.status(204).send();
}
