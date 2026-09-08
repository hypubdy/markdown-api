import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import type { RouteTable } from "../utils/router";
import { schemas } from "./components";

/**
 * GENERATOR OPENAPI — sinh spec Swagger TỰ ĐỘNG từ các bảng route trong *.routes.ts
 * (không còn file spec khai báo tay).
 *
 * Cách hoạt động:
 * - modules/index.ts export danh sách "nhóm mount": { prefix, table, authenticated, tag }.
 * - Mỗi route mang field `openapi` (RouteOpenApi): summary + CHÍNH schema zod validate
 *   ({ body?, query?, params? }) → generator chuyển zod → JSON Schema (zod-to-json-schema).
 * - Đường dẫn ":id" tự trở thành path parameter; method/path lấy từ route object.
 */

export interface MountGroup {
  /** prefix mount, vd "/notes"; có thể rỗng "" (vd /health) */
  prefix: string;
  table: RouteTable;
  /** nhóm có chạy middleware authenticate cấp module hay không */
  authenticated: boolean;
  /** nhóm tag hiển thị trên Swagger UI */
  tag: string;
}

interface BuildOptions {
  info: { title: string; version: string; description?: string };
  groups: MountGroup[];
}

const METHOD_LOWER = ["get", "post", "put", "patch", "delete"] as const;

const statusText: Record<number, string> = {
  200: "Thành công",
  201: "Tạo thành công",
  204: "Đã xoá (không có nội dung trả về)",
  400: "Dữ liệu đầu vào không hợp lệ (validate zod)",
  401: "Chưa xác thực — thiếu token / token sai hoặc hết hạn",
  403: "Không có quyền (cần admin)",
  404: "Không tìm thấy (kể cả khi tài nguyên không phải của bạn)",
  409: "Xung đột (vd email/tag đã tồn tại)",
};

/** Introspect schema zod dạng { body?, query?, params? } */
function partsOf(schema: ZodTypeAny | undefined): {
  body?: ZodTypeAny;
  query?: Record<string, ZodTypeAny>;
  params?: Record<string, ZodTypeAny>;
} {
  if (!schema) return {};
  const shape = (schema as { shape?: Record<string, ZodTypeAny> }).shape;
  if (!shape) return {};
  const pick = (key: string): Record<string, ZodTypeAny> | undefined => {
    const sub = shape[key] as
      | { shape?: Record<string, ZodTypeAny> }
      | undefined;
    return sub?.shape ? sub.shape : undefined;
  };
  return {
    body: shape.body as ZodTypeAny | undefined,
    query: pick("query"),
    params: pick("params"),
  };
}

/** zod → OpenAPI schema (bỏ $schema, defs rác nếu có) */
function toOpenApiSchema(zod: ZodTypeAny): Record<string, unknown> {
  const raw = zodToJsonSchema(zod, { target: "openApi3" }) as Record<
    string,
    unknown
  >;
  const { $schema: _schema, ...rest } = raw;
  return rest;
}

const isOptional = (zod: ZodTypeAny): boolean =>
  Boolean((zod as { isOptional?: () => boolean }).isOptional?.());

function responseObject(success: number, description: string, data?: Record<string, unknown>) {
  if (success === 204) return { description };
  const properties: Record<string, unknown> = { success: { type: "boolean" } };
  if (data) properties.data = data;
  return {
    description,
    content: {
      "application/json": {
        schema: { type: "object", properties },
      },
    },
  };
}

/** Dựng document OpenAPI từ danh sách nhóm mount */
export function buildOpenApiDocument(options: BuildOptions): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const group of options.groups) {
    for (const [name, route] of Object.entries(group.table)) {
      const doc = route.openapi;
      if (!doc) continue; // route không mang metadata → bỏ qua khỏi spec

      const fullPath =
        group.prefix === ""
          ? route.path
          : `${group.prefix}${route.path === "/" ? "" : route.path}`;
      const parts = partsOf(doc.schema);

      // ── Parameters ────────────────────────────────────────────
      const parameters: Record<string, unknown>[] = [];

      // path params: từ token ":x" trong path (+ schema params nếu có)
      const pathTokens = fullPath
        .split("/")
        .filter((seg) => seg.startsWith(":") && seg.length > 1)
        .map((seg) => seg.slice(1));
      for (const name of pathTokens) {
        const zodParam = parts.params?.[name];
        parameters.push({
          name,
          in: "path",
          required: true,
          schema: zodParam ? toOpenApiSchema(zodParam) : { type: "string" },
        });
      }

      // query params: từ schema.query
      if (parts.query) {
        for (const [name, zod] of Object.entries(parts.query)) {
          parameters.push({
            name,
            in: "query",
            required: !isOptional(zod),
            schema: toOpenApiSchema(zod),
          });
        }
      }

      // ── Request body ──────────────────────────────────────────
      const operation: Record<string, unknown> = {
        tags: [group.tag],
        summary: doc.summary ?? name,
        parameters,
      };
      if (doc.description) operation.description = doc.description;
      if (group.authenticated) {
        operation.security = [{ bearerAuth: [] }];
      }
      if (parts.body) {
        operation.requestBody = {
          required: true,
          content: {
            "application/json": { schema: toOpenApiSchema(parts.body) },
          },
        };
      }

      // ── Responses ─────────────────────────────────────────────
      const success = doc.success ?? 200;
      const responses: Record<string, unknown> = {
        [success]: responseObject(success, statusText[success] ?? "Thành công", doc.data),
      };
      // lỗi chung + lỗi theo hoàn cảnh
      const errorDescriptions = doc.errorDescriptions ?? {};
      responses["400"] = { description: statusText[400] };
      if (group.authenticated && !(401 in responses)) {
        responses["401"] = { description: statusText[401] };
      }
      if (pathTokens.length > 0 && !(404 in responses)) {
        responses["404"] = { description: statusText[404] };
      }
      for (const [code, desc] of Object.entries(errorDescriptions)) {
        responses[code] = { description: desc };
      }
      operation.responses = responses;

      const method = route.method.toLowerCase() as (typeof METHOD_LOWER)[number];
      const pathKey = fullPath.replace(/\/{/g, "/").replace(/:/g, "{");
      paths[pathKey] = { ...(paths[pathKey] ?? {}), [method]: operation };
    }
  }

  return {
    openapi: "3.0.3",
    info: options.info,
    servers: [{ url: "http://localhost:3000/api/v1" }],
    tags: [...new Set(options.groups.map((g) => g.tag))].map((name) => ({ name })),
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas,
    },
    paths,
  };
}

/** Mount Swagger UI + spec JSON (đặt TRƯỚC not-found/error-handler trong app.ts) */
export function mountSwagger(
  app: Express,
  document: Record<string, unknown>,
): void {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(document));
  app.get("/api-docs.json", (_req, res) => {
    res.json(document);
  });
}
