import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";

/** Mọi request không khớp route nào đều đi qua đây */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound(`Không tìm thấy route: ${req.method} ${req.originalUrl}`));
}
