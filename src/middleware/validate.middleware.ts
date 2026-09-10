import type { MiddlewareHandler } from "hono";
import { ZodError, ZodObject, type ZodTypeAny } from "zod";
import type { AppEnv, ValidatedRequest } from "../types/hono";
import { ApiError } from "../utils/ApiError";

/** Validate body/query/params và lưu dữ liệu đã chuẩn hoá vào Hono context. */
export function validate(schema: ZodTypeAny): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!(schema instanceof ZodObject)) {
      throw new Error("validate() chỉ hỗ trợ z.object()");
    }

    try {
      const shape = schema.shape as Record<string, ZodTypeAny>;
      const input: ValidatedRequest = {};
      if (shape.body) {
        try {
          input.body = await c.req.json();
        } catch {
          input.body = undefined;
        }
      }
      if (shape.query) input.query = c.req.query();
      if (shape.params) input.params = c.req.param();

      c.set("validated", schema.parse(input) as ValidatedRequest);
      await next();
    } catch (error) {
      if (error instanceof ZodError) {
        throw ApiError.badRequest(
          "Dữ liệu đầu vào không hợp lệ",
          error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
      }
      throw error;
    }
  };
}

export function validated<T>(c: { get(key: "validated"): ValidatedRequest | undefined }, source: keyof ValidatedRequest): T {
  return c.get("validated")?.[source] as T;
}
