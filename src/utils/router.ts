import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import type { ZodTypeAny } from "zod";
import { asyncHandler } from "./async-handler";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/**
 * Metadata OpenAPI/Swagger gắn NGAY trên route (khai báo trong *.routes.ts).
 * Generator src/swagger/build.ts đọc field này để sinh spec tự động
 * ("single source of truth": route mô tả chính nó).
 */
export interface RouteOpenApi {
  /** Mô tả ngắn endpoint — hiển thị trên Swagger UI */
  summary?: string;
  /** Mô tả dài (tuỳ chọn) */
  description?: string;
  /**
   * Schema zod dạng { body?, query?, params? } — thường CHÍNH LÀ schema truyền
   * cho middleware validate() của route. Generator chuyển zod → OpenAPI schema.
   */
  schema?: ZodTypeAny;
  /** Mã thành công nếu khác 200 (vd 201 khi tạo resource) */
  success?: number;
  /** JSON Schema cho field data trong response thành công (inline hoặc {$ref}) */
  data?: Record<string, unknown>;
  /** Ghi đè mô tả các lỗi bổ sung: { "409": "Email đã được đăng ký", "403": "Cần admin" } */
  errorDescriptions?: Record<string, string>;
}

/** Định nghĩa một endpoint trong bảng route */
export interface RouteDefinition {
  /** HTTP method */
  method: HttpMethod;
  /** Đường dẫn tương đối trong module */
  path: string;
  /** Middleware chỉ áp dụng riêng cho endpoint này (chạy trước action) */
  middlewares?: RequestHandler[];
  /**
   * Action xử lý endpoint — khai báo dạng async thuần.
   * createRouter() tự bọc asyncHandler, mọi lỗi ném ra đều chảy về error-handler.
   */
  action: (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
  /** Tài liệu OpenAPI của endpoint (sinh spec tự động) */
  openapi?: RouteOpenApi;
}

/**
 * Route được khai báo dạng OBJECT (bảng route).
 * - key: tên route — giúp đọc hiểu nhanh, dễ tìm trong log
 * - value: cấu hình { method, path, middlewares, action }
 * Thứ tự key chính là thứ tự các route được đăng ký vào router.
 */
export type RouteTable = Record<string, RouteDefinition>;

/**
 * Biến bảng route dạng object thành Express Router.
 * @param table  bảng route của module
 * @param options.middlewares  middleware chạy cho MỌI route trong bảng
 *                             (tương đương router.use, ví dụ authenticate)
 */
export function createRouter(
  table: RouteTable,
  options: { middlewares?: RequestHandler[] } = {},
) {
  const router = Router();

  if (options.middlewares && options.middlewares.length > 0) {
    router.use(options.middlewares);
  }

  // Map method string -> hàm đăng ký tương ứng của Router (giữ type-safe)
  const register: Record<HttpMethod, (path: string, ...handlers: RequestHandler[]) => void> = {
    get: (path, ...handlers) => router.get(path, ...handlers),
    post: (path, ...handlers) => router.post(path, ...handlers),
    put: (path, ...handlers) => router.put(path, ...handlers),
    patch: (path, ...handlers) => router.patch(path, ...handlers),
    delete: (path, ...handlers) => router.delete(path, ...handlers),
  };

  for (const route of Object.values(table)) {
    const { method, path, middlewares = [], action } = route;
    register[method](path, ...middlewares, asyncHandler(action));
  }

  return router;
}
