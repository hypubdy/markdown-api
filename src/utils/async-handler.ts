import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Bọc một handler bất đồng bộ (action) để mọi promise bị reject
 * đều được đẩy xuống error-handler middleware thay vì crash server.
 */
export const asyncHandler =
  (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
