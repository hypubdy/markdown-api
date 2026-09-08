import { validate } from "../../middleware/validate.middleware";
import type { RouteTable } from "../../utils/router";
import {
  createNote,
  disableShare,
  enableShare,
  getNote,
  getRawNote,
  hardDeleteNote,
  listNotes,
  listTrashNotes,
  restoreNote,
  softDeleteNote,
  updateNote,
} from "./notes.actions";
import {
  createNoteSchema,
  listNotesQuerySchema,
  noteIdParamSchema,
  updateNoteSchema,
} from "./notes.schemas";

/**
 * ROUTES của module notes — khai báo dạng OBJECT.
 * Toàn bộ route module này đều cần đăng nhập: middleware authenticate được gắn
 * ở cấp module (xem modules/index.ts).
 *
 * THỨ TỰ QUAN TRỌNG (Express match theo thứ tự khai báo):
 * - "/trash" và mọi tuyến 2-đoạn ("/:id/raw", "/:id/share") phải đứng TRƯỚC
 *   các tuyến "/:id" cùng method, nếu không "trash"/"raw" bị ":id" nuốt mất.
 *
 * Field `openapi` = tài liệu Swagger gắn ngay trên route (generator đọc để sinh spec).
 */
export const notesRoutes: RouteTable = {
  listNotes: {
    method: "get",
    path: "/",
    middlewares: [validate(listNotesQuerySchema)],
    action: listNotes,
    openapi: {
      summary: "Danh sách note của mình (còn sống) — lọc q/status/tag, phân trang",
      schema: listNotesQuerySchema,
      data: { $ref: "#/components/schemas/NoteList" },
    },
  },
  listTrashNotes: {
    method: "get",
    path: "/trash",
    action: listTrashNotes,
    openapi: {
      summary: "Thùng rác: note đã soft-delete",
      data: { $ref: "#/components/schemas/NoteList" },
    },
  },
  restoreNote: {
    method: "post",
    path: "/trash/:id/restore",
    middlewares: [validate(noteIdParamSchema)],
    action: restoreNote,
    openapi: {
      summary: "Khôi phục note từ thùng rác",
      schema: noteIdParamSchema,
      data: { $ref: "#/components/schemas/Note" },
    },
  },
  hardDeleteNote: {
    method: "delete",
    path: "/trash/:id",
    middlewares: [validate(noteIdParamSchema)],
    action: hardDeleteNote,
    openapi: {
      summary: "Xoá HẲN note (không khôi phục được)",
      schema: noteIdParamSchema,
      success: 204,
    },
  },
  getRawNote: {
    method: "get",
    path: "/:id/raw",
    middlewares: [validate(noteIdParamSchema)],
    action: getRawNote,
    openapi: {
      summary: "Nội dung dạng text/markdown (cho editor)",
      description: "Trả về content thuần với Content-Type text/markdown (không phải JSON).",
      schema: noteIdParamSchema,
    },
  },
  enableShare: {
    method: "post",
    path: "/:id/share",
    middlewares: [validate(noteIdParamSchema)],
    action: enableShare,
    openapi: {
      summary: "Bật chia sẻ public → shareToken + url",
      schema: noteIdParamSchema,
      data: { $ref: "#/components/schemas/ShareResult" },
    },
  },
  disableShare: {
    method: "delete",
    path: "/:id/share",
    middlewares: [validate(noteIdParamSchema)],
    action: disableShare,
    openapi: {
      summary: "Thu hồi chia sẻ public",
      schema: noteIdParamSchema,
      data: { $ref: "#/components/schemas/ShareRevoke" },
    },
  },
  getNote: {
    method: "get",
    path: "/:id",
    middlewares: [validate(noteIdParamSchema)],
    action: getNote,
    openapi: {
      summary: "Chi tiết note (chỉ chủ sở hữu; người khác → 404)",
      schema: noteIdParamSchema,
      data: { $ref: "#/components/schemas/Note" },
    },
  },
  updateNote: {
    method: "patch",
    path: "/:id",
    middlewares: [validate(updateNoteSchema)],
    action: updateNote,
    openapi: {
      summary: "Cập nhật note (title/content/status/tagNames)",
      schema: updateNoteSchema,
      data: { $ref: "#/components/schemas/Note" },
    },
  },
  softDeleteNote: {
    method: "delete",
    path: "/:id",
    middlewares: [validate(noteIdParamSchema)],
    action: softDeleteNote,
    openapi: {
      summary: "Soft-delete note (vào thùng rác)",
      schema: noteIdParamSchema,
      success: 204,
    },
  },
  createNote: {
    method: "post",
    path: "/",
    middlewares: [validate(createNoteSchema)],
    action: createNote,
    openapi: {
      summary: "Tạo note markdown mới",
      schema: createNoteSchema,
      success: 201,
      data: { $ref: "#/components/schemas/Note" },
    },
  },
};
