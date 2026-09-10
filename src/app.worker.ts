import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, RuntimeServices } from "./types/hono";
import { clerkAuthenticationMiddleware } from "./middleware/authenticate.middleware";
import { errorHandler } from "./middleware/error-handler.middleware";
import { notFoundHandler } from "./middleware/not-found.middleware";
import { requestLogger } from "./middleware/request-logger.middleware";
import { apiMountGroups, apiRouter } from "./modules/index";
import { buildOpenApiDocument, mountSwagger } from "./swagger/build";

const document = buildOpenApiDocument({ info: { title: "Hono — API lưu trữ Markdown", version: "1.0.0" }, groups: apiMountGroups });

export function createWorkerApp(services: RuntimeServices): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("services", services); await next(); });
  app.use("*", secureHeaders());
  app.use("*", cors());
  app.use("*", requestLogger);
  app.use("*", clerkAuthenticationMiddleware);
  app.route("/api/v1", apiRouter);
  mountSwagger(app, document);
  app.notFound(notFoundHandler);
  app.onError(errorHandler);
  return app;
}
