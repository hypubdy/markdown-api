import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import type { MiddlewareHandler } from "hono";
import { env } from "../config/env";
import type { AppEnv } from "../types/hono";
import { ApiError } from "../utils/ApiError";
import { verifyAccessToken } from "../utils/jwt";
import { syncUserFromClerkUser } from "./clerk-sync";

export const clerkAuthenticationMiddleware: MiddlewareHandler<AppEnv> =
  env.AUTH_PROVIDER === "clerk"
    ? clerkMiddleware({
        publishableKey: env.CLERK_PUBLISHABLE_KEY,
        secretKey: env.CLERK_SECRET_KEY,
        clockSkewInMs: env.CLERK_CLOCK_SKEW_MS,
      }) as MiddlewareHandler<AppEnv>
    : async (_c, next) => next();

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    if (env.AUTH_PROVIDER === "clerk") {
      const auth = getAuth(c);
      if (!auth?.userId) throw ApiError.unauthorized("Clerk session token khong hop le hoac da het han");
      const users = await c.get("services").getUserRepository();
      let user = await users.findByClerkUserId(auth.userId);
      if (!user) {
        const clerk = c.get("clerk" as never) as { users: { getUser(id: string): Promise<Parameters<typeof syncUserFromClerkUser>[0]> } };
        user = await syncUserFromClerkUser(
          await clerk.users.getUser(auth.userId),
          users,
          auth.userId,
        );
      }
      c.set("user", { id: user.id, email: user.email, role: user.role });
    } else {
      const header = c.req.header("Authorization");
      if (!header?.startsWith("Bearer ")) throw ApiError.unauthorized("Thieu token - can header Authorization: Bearer <token>");
      c.set("user", verifyAccessToken(header.slice("Bearer ".length).trim()));
    }
    await next();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.unauthorized("Token khong hop le hoac da het han");
  }
};
