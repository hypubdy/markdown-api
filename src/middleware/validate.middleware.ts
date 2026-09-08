import type { NextFunction, Request, Response } from "express";
import { ZodError, ZodObject, type ZodTypeAny } from "zod";
import { ApiError } from "../utils/ApiError";

/**
 * Middleware validate dữ liệu đầu vào theo schema Zod.
 * Schema mong đợi dạng z.object({ body?, query?, params? }) —
 * chỉ những nguồn nào khai báo trong schema mới bị ghi đè bằng dữ liệu đã chuẩn hoá.
 */
export function validate(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!(schema instanceof ZodObject)) {
      return next(new Error("validate() chỉ hỗ trợ z.object()"));
    }

    try {
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      for (const source of Object.keys(schema.shape)) {
        (req as unknown as Record<string, unknown>)[source] = parsed[source];
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        return next(ApiError.badRequest("Dữ liệu đầu vào không hợp lệ", details));
      }
      next(error);
    }
  };
}
