import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { isProduction } from "../config/env";

/**
 * Error-handler DUY NHẤT đặt ở cuối chuỗi middleware.
 * - ApiError (lỗi nghiệp vụ): trả đúng status code + message.
 * - Lỗi khác (bug, lỗi hệ thống): log chi tiết, trả 500, không lộ stack khi ở production.
 * Bắt buộc khai báo đủ 4 tham số để Express nhận diện đây là middleware xử lý lỗi.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details !== undefined && { details: err.details }),
    });
  }

  const error = err instanceof Error ? err : new Error(String(err));
  console.error(`[${new Date().toISOString()}] Lỗi không xác định:`, error);

  return res.status(500).json({
    success: false,
    message: isProduction ? "Lỗi máy chủ nội bộ" : error.message,
  });
}
