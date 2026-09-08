import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/authenticate.middleware";
import { asyncHandler } from "../utils/async-handler";
import { createRouter } from "../utils/router";
import { authRoutes } from "./auth/auth.routes";
import { userRoutes } from "./user/user.routes";

/**
 * Router gốc /api/v1 — nơi ráp các MODULE lại với nhau.
 * Thêm module mới chỉ cần 2 việc:
 *   1. tạo thư mục modules/<tên>/ chứa <tên>.actions.ts + <tên>.routes.ts
 *   2. thêm một dòng createRouter(...) bên dưới
 */
export const apiRouter = Router();

// Health — endpoint hệ thống, đặt thẳng ở router gốc
apiRouter.get(
  "/health",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        status: "ok",
        uptime: `${Math.round(process.uptime())}s`,
        timestamp: new Date().toISOString(),
      },
    });
  }),
);

// Module auth — công khai
apiRouter.use("/auth", createRouter(authRoutes));

// Module user — toàn bộ route cần đăng nhập (middleware cấp module)
apiRouter.use(
  "/users",
  createRouter(userRoutes, { middlewares: [authenticate] }),
);
