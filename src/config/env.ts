import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(3000),
    JWT_SECRET: z.string().min(1, "Missing JWT_SECRET"),
    JWT_EXPIRES_IN: z.string().default("15m"),
    AUTH_PROVIDER: z.enum(["local", "clerk"]).default("local"),
    CLERK_PUBLISHABLE_KEY: z.string().optional(),
    CLERK_SECRET_KEY: z.string().optional(),
    CLERK_CLOCK_SKEW_MS: z.coerce.number().int().min(0).default(60_000),
    DB_DRIVER: z.enum(["d1", "supabase", "sqlite"]).default("sqlite"),
    DB_FILE: z.string().default(":memory:"),
    SUPABASE_URL: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    DATABASE_URL: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.AUTH_PROVIDER === "clerk" && (!val.CLERK_PUBLISHABLE_KEY || !val.CLERK_SECRET_KEY)) {
      ctx.addIssue({ code: "custom", message: "Missing Clerk keys when AUTH_PROVIDER=clerk", path: ["CLERK_SECRET_KEY"] });
    }
    if (val.DB_DRIVER === "supabase" && (!val.SUPABASE_URL || !val.SUPABASE_SERVICE_ROLE_KEY)) {
      ctx.addIssue({ code: "custom", message: "Missing Supabase URL or service role key", path: ["SUPABASE_URL"] });
    }
  });

export type AppEnvConfig = z.infer<typeof envSchema>;

function readEnv(): AppEnvConfig {
  const source = typeof process !== "undefined" && process.env ? process.env : {};
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${JSON.stringify(parsed.error.flatten())}`);
  }
  return parsed.data;
}

// Resolve lazily: Cloudflare Worker bindings are available only during fetch().
export const env = new Proxy({} as AppEnvConfig, {
  get(_target, property: string) {
    return readEnv()[property as keyof AppEnvConfig];
  },
});

export const isProduction = new Proxy({} as { value: boolean }, {
  get(_target, property: string) {
    if (property === "value") return readEnv().NODE_ENV === "production";
    return undefined;
  },
}) as unknown as boolean;
