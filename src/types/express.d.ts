import type { AuthUser } from "./index";

// Mở rộng interface Request của Express:
// sau khi đi qua middleware `authenticate`, req.user sẽ có sẵn thông tin người dùng.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
