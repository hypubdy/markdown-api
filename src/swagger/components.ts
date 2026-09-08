/**
 * JSON Schema dùng chung cho spec OpenAPI (components.schemas).
 * Route table chỉ cần tham chiếu: data: { $ref: "#/components/schemas/Note" }.
 */

const ts = { type: "string" } as const;

export const schemas: Record<string, Record<string, unknown>> = {
  User: {
    type: "object",
    properties: {
      id: { ...ts, format: "uuid" },
      name: ts,
      email: { ...ts, format: "email" },
      role: { type: "string", enum: ["admin", "user"] },
      createdAt: { ...ts, format: "date-time" },
      updatedAt: { ...ts, format: "date-time" },
    },
  },
  UserList: { type: "array", items: { $ref: "#/components/schemas/User" } },
  UserProfile: {
    type: "object",
    properties: {
      id: { ...ts, format: "uuid" },
      name: ts,
      role: { type: "string", enum: ["admin", "user"] },
      createdAt: { ...ts, format: "date-time" },
    },
  },
  UserStats: {
    type: "object",
    properties: {
      total: { type: "number" },
      admins: { type: "number" },
      users: { type: "number" },
    },
  },
  AuthResult: {
    type: "object",
    required: ["token", "user"],
    properties: {
      token: ts,
      user: { $ref: "#/components/schemas/User" },
    },
  },
  Note: {
    type: "object",
    properties: {
      id: { ...ts, format: "uuid" },
      ownerId: { ...ts, format: "uuid" },
      title: ts,
      content: ts,
      status: { type: "string", enum: ["draft", "published"] },
      tags: { type: "array", items: ts },
      deletedAt: { type: ["string", "null"], format: "date-time" },
      shareToken: { type: ["string", "null"] },
      createdAt: { ...ts, format: "date-time" },
      updatedAt: { ...ts, format: "date-time" },
    },
  },
  NoteList: { type: "array", items: { $ref: "#/components/schemas/Note" } },
  ShareResult: {
    type: "object",
    properties: {
      shareToken: ts,
      url: ts,
    },
  },
  ShareRevoke: {
    type: "object",
    properties: {
      shareToken: { type: ["string", "null"] },
    },
  },
  PublicNote: {
    type: "object",
    properties: {
      id: { ...ts, format: "uuid" },
      title: ts,
      content: ts,
      updatedAt: { ...ts, format: "date-time" },
    },
  },
  TagCount: {
    type: "object",
    properties: {
      name: ts,
      count: { type: "number" },
    },
  },
  TagList: { type: "array", items: { $ref: "#/components/schemas/TagCount" } },
};
