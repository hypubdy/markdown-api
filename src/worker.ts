import { createWorkerApp } from "./app.worker";
import * as workerServices from "./data/index.worker";
import type { WorkerBindings } from "./types/hono";

const app = createWorkerApp(workerServices);
let initialized: Promise<void> | undefined;

/** Cloudflare Worker entry; schema migrations run separately via Wrangler D1. */
export default {
  async fetch(
    request: Request,
    env: WorkerBindings,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<Response> {
    const { DB, ...config } = env;
    Object.assign(process.env, config);

    if (env.AUTH_PROVIDER && env.AUTH_PROVIDER !== "clerk") {
      return Response.json(
        { success: false, message: "Cloudflare Worker chỉ hỗ trợ AUTH_PROVIDER=clerk" },
        { status: 500 },
      );
    }
    if (env.DB_DRIVER && env.DB_DRIVER !== "d1") {
      return Response.json(
        { success: false, message: "Cloudflare Worker chỉ hỗ trợ DB_DRIVER=d1" },
        { status: 500 },
      );
    }

    workerServices.configureDatabase(DB);
    initialized ??= workerServices.initDatabase();
    ctx.waitUntil(initialized);
    await initialized;
    return app.fetch(request, { ...config, DB });
  },
};
