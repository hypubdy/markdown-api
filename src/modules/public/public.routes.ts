import { z } from "zod";
import { validate } from "../../middleware/validate.middleware";
import type { RouteTable } from "../../utils/router";
import { getPublicNote } from "./public.actions";

/**
 * shareToken KHÔNG phải uuid — chỉ là chuỗi hex 32 ký tự do action sinh ra.
 * Validate lỏng (chuỗi không rỗng) để token lạ đi vào action và trả 404,
 * KHÔNG bị chặn 400 vì "sai định dạng" (đúng hợp đồng test).
 */
const shareTokenParamSchema = z.object({
  params: z.object({
    shareToken: z.string().min(1).max(200, "shareToken quá dài"),
  }),
});

/**
 * ROUTES của module public — KHÔNG cần đăng nhập.
 * createRouter được gọi KHÔNG kèm authenticate (xem modules/index.ts).
 * Field `openapi` = tài liệu Swagger gắn ngay trên route.
 */
export const publicRoutes: RouteTable = {
  getPublicNote: {
    method: "get",
    path: "/notes/:shareToken",
    middlewares: [validate(shareTokenParamSchema)],
    action: getPublicNote,
    openapi: {
      summary: "Xem note được chia sẻ — KHÔNG cần đăng nhập",
      schema: shareTokenParamSchema,
      data: { $ref: "#/components/schemas/PublicNote" },
    },
  },
};
