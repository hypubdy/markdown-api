import type { AppContext } from "../../types/hono";
import { toSafeUser } from "../../data/user.repository";
import { validated } from "../../middleware/validate.middleware";
import type { ListUsersQuery, UpdateRoleBody } from "./user.schemas";
import { ApiError } from "../../utils/ApiError";

export async function listUsers(c: AppContext) {
  const { role, q } = validated<ListUsersQuery>(c, "query");
  let users = await (await c.get("services").getUserRepository()).findAll();
  if (role) users = users.filter((user) => user.role === role);
  if (q) {
    const needle = q.toLowerCase();
    users = users.filter((user) => user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle));
  }
  return c.json({ success: true, data: users.map(toSafeUser) });
}

export async function getStats(c: AppContext) {
  const users = await (await c.get("services").getUserRepository()).findAll();
  return c.json({ success: true, data: {
    total: users.length,
    admins: users.filter((u) => u.role === "admin").length,
    users: users.filter((u) => u.role === "user").length,
  }});
}

export async function getUserProfile(c: AppContext) {
  const { id } = validated<{ id: string }>(c, "params");
  const user = await (await c.get("services").getUserRepository()).findById(id);
  if (!user) throw ApiError.notFound("Không tìm thấy người dùng");
  return c.json({ success: true, data: { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt } });
}

export async function getMe(c: AppContext) {
  const user = await (await c.get("services").getUserRepository()).findById(c.get("user")!.id);
  if (!user) throw ApiError.notFound("Không tìm thấy người dùng của token này");
  return c.json({ success: true, data: toSafeUser(user) });
}

export async function getUserById(c: AppContext) {
  const { id } = validated<{ id: string }>(c, "params");
  const user = await (await c.get("services").getUserRepository()).findById(id);
  if (!user) throw ApiError.notFound("Không tìm thấy người dùng");
  return c.json({ success: true, data: toSafeUser(user) });
}

export async function updateRole(c: AppContext) {
  const { id } = validated<{ id: string }>(c, "params");
  const { role } = validated<UpdateRoleBody>(c, "body");
  const updated = await (await c.get("services").getUserRepository()).updateRole(id, role);
  if (!updated) throw ApiError.notFound("Không tìm thấy người dùng");
  return c.json({ success: true, message: "Đã cập nhật role", data: toSafeUser(updated) });
}

export async function deleteUser(c: AppContext) {
  const { id } = validated<{ id: string }>(c, "params");
  if (c.get("user")!.id === id) throw ApiError.badRequest("Không thể tự xoá tài khoản của chính mình");
  const deleted = await (await c.get("services").getUserRepository()).deleteById(id);
  if (!deleted) throw ApiError.notFound("Không tìm thấy người dùng");
  return c.body(null, 204);
}


