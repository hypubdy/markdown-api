import { createWorkerApp } from "./app.worker";
import * as workerServices from "./data/index.worker";

const app = createWorkerApp(workerServices);
let initialized: Promise<void> | undefined;

/** Cloudflare Worker entry; schema migrations run separately via supabase/schema.sql. */
export default {
  async fetch(request: Request, env: Record<string, string>, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    if (env.AUTH_PROVIDER && env.AUTH_PROVIDER !== "clerk") {
      return Response.json({ success: false, message: "Cloudflare Worker chỉ hỗ trợ AUTH_PROVIDER=clerk" }, { status: 500 });
    }
    if (env.DB_DRIVER && env.DB_DRIVER !== "supabase") {
      return Response.json({ success: false, message: "Cloudflare Worker chỉ hỗ trợ DB_DRIVER=supabase" }, { status: 500 });
    }
    initialized ??= workerServices.initDatabase();
    ctx.waitUntil(initialized);
    await initialized;
    return app.fetch(request, env);
  },
};
