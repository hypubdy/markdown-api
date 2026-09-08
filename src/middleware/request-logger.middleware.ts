import type { NextFunction, Request, Response } from "express";

/** Log mỗi request: method, đường dẫn, thời gian xử lý */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startedAt;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`,
    );
  });

  next();
}
