# BACKEND PLAN — App lưu trữ Markdown

> Trạng thái: **SPEC CHÍNH THỨC (đã chốt)** — ngày chốt quyết định bên dưới.
> Nền tảng: tiếp tục trong dự án `express-ts-app` hiện tại.

---

## 1. Mục tiêu & phạm vi (ĐÃ CHỐT)

Backend lưu trữ tài liệu markdown theo tài khoản. Mỗi user quản lý note của riêng mình.

**Quyết định đã chốt:**
- [x] Phát triển TRONG `express-ts-app` (tái dùng auth, repository đa driver, Docker PG, test framework).
- [x] V1 gồm: **CRUD + search/phân trang** (MVP thuần) + **Tags** + **Soft-delete / thùng rác** + **Public share**.
- [x] Không làm ở v1: Folder, Lịch sử phiên bản.
- [x] Quyền: **chỉ owner** thao tác note — admin KHÔNG sửa/xoá note người khác.
- [x] Xoá: **soft-delete từ đầu** (`deleted_at`) — xoá hẳn chỉ qua thùng rác.

---

## 2. Model dữ liệu

### 2.1. Bảng `notes`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid / text PK | `randomUUID()` |
| `owner_id` | FK → `users.id` NOT NULL | chủ sở hữu |
| `title` | text NOT NULL | tiêu đề |
| `content` | text NOT NULL DEFAULT '' | markdown thô |
| `status` | `'draft' \| 'published'` | mặc định `draft` |
| `deleted_at` | timestamptz / text NULL | soft-delete; NULL = còn sống |
| `share_token` | text NULL UNIQUE | token public share |
| `created_at`, `updated_at` | như `users` | |

Index: `(owner_id)`, `(owner_id, updated_at DESC)`, `(owner_id, deleted_at)`.
Filter mặc định mọi danh sách: `owner_id = ? AND deleted_at IS NULL`.

### 2.2. Bảng `tags` + `note_tags`
- `tags`: `id PK, owner_id FK, name text`, UNIQUE `(owner_id, name)`.
- `note_tags`: `note_id FK, tag_id FK`, PK `(note_id, tag_id)`.
- Một tag thuộc về một user (không share giữa user).
- Có thể xoá tag rời khỏi note; xoá hẳn tag khi hết dùng (hoặc endpoint DELETE tag).

### 2.3. Public share
- `notes.share_token` sinh ngẫu nhiên (crypto) khi user bật chia sẻ; thu hồi = xoá token.
- Đường public KHÔNG qua middleware authenticate (middleware xác thực vẫn chạy cho các route
  còn lại vì share được mount riêng, KHÔNG nằm trong module `notes` có authenticate cấp module).

---

## 3. API (prefix `/api/v1`) — ĐÃ CHỐT

### 3.1. Notes — cần đăng nhập (authenticate cấp module)
| Method | Path | Mô tả |
|---|---|---|
| POST | `/notes` | Tạo `{ title, content?, status?, tagNames? }` → 201 |
| GET | `/notes` | Danh sách note SỐNG của mình: `?q=&status=&tag=&page=&limit=` |
| GET | `/notes/:id` | Chi tiết 1 note (kèm `tags`) |
| GET | `/notes/:id/raw` | Nội dung dạng `text/markdown` (cho editor) |
| PATCH | `/notes/:id` | Sửa `{ title?, content?, status?, tagNames? }` → bump `updated_at` |
| POST | `/notes/:id/share` | Bật public → `{ shareToken, url }` |
| DELETE | `/notes/:id/share` | Thu hồi public |
| DELETE | `/notes/:id` | **Soft-delete** (vào thùng rác) |

### 3.2. Thùng rác — cần đăng nhập
| Method | Path | Mô tả |
|---|---|---|
| GET | `/notes/trash` | Danh sách note đã xoá mềm |
| POST | `/notes/trash/:id/restore` | Khôi phục (xoá `deleted_at`) |
| DELETE | `/notes/trash/:id` | Xoá HẲN (không khôi phục được) |

### 3.3. Tags — cần đăng nhập
| Method | Path | Mô tả |
|---|---|---|
| GET | `/tags` | Tags của mình kèm `count` note đang sống (kể cả tag count 0) |
| DELETE | `/tags/:name` | Xoá tag khỏi mọi note |

### 3.4. Public — KHÔNG cần đăng nhập (mount riêng ngoài authenticate)
| Method | Path | Mô tả |
|---|---|---|
| GET | `/public/notes/:shareToken` | Xem note được chia sẻ `{ title, content, updatedAt }` |

### Quy tắc
- **Ownership check trong action**: note không thuộc mình → 404 (không lộ tồn tại).
- **Route-object thứ tự**: `/notes/trash`… khai báo TRƯỚC `/notes/:id`; `/notes/:id/share`/`raw`
  là path 2 đoạn, không đụng `/notes/:id`.
- Validate zod: `title` 1–200 ký tự; `content` ≤ 1MB; `tagNames` ≤ 20 tag/lần, mỗi tag 1–30 ký tự.
- Phân trang: `{ data, pagination: { page, limit, total, pages } }`.
- Search MVP: `ILIKE/LIKE '%q%'` trên `title` (và content).

---

## 4. Phân rã công việc

### Phase 1 — Tầng dữ liệu notes/tags
1. `src/data/note.repository.ts` — interface `NoteRepository` + mapper/DDL:
   - Notes: `create, findById(ownerId), list({ownerId, q?, status?, tag?, page, limit}),
     listTrash(ownerId), update, softDelete, restore, hardDelete,
     setShare(ownerId,id,token), clearShare(...)`.
   - Tags: `listTagsWithCount(ownerId), addTags, replaceNoteTags(noteId,names), removeTagByName(ownerId,name)`.
2. `note.pg.repository.ts` + `note.sqlite.repository.ts` (DDL, `PRAGMA foreign_keys=ON` cho sqlite).
3. Mở rộng `src/data/index.ts`: `getNoteRepository()`, init tạo 3 bảng, `clearAllNotes()` cho test file.
4. **Định nghĩa xong**: typecheck + test cũ xanh; PG tạo bảng khi chạy server/seed.

### Phase 2 — Module notes API (CRUD + trash + share + tags)
1. `src/modules/notes/notes.schemas.ts` — create/update/list/query/trash/share schemas.
2. `notes.actions.ts` — đủ action; **transactions** (pg) cho `replaceNoteTags` khi có 2 bảng.
3. `notes.routes.ts` — bảng route object + `authorize`? không (chỉ owner) — authenticate cấp module.
4. Mount `/notes`, `/tags` vào modules/index; **public** mount riêng `GET /public/notes/:token` KHÔNG authenticate.
5. **Định nghĩa xong**: curl demo CRUD + chủ khác 404 + share public xem không cần token + trash restore.

### Phase 3 — Search & phân trang hoàn chỉnh (q, status, tag, page/limit + COUNT).
### Phase 4 — Test data-driven `tests/notes.test.ts` (bảng case trong file; fixture qua prepare()).
### Phase 5 — Seed demo (notes markdown mẫu cho user demo) + README + rate-limit nhẹ cho create/update.

---

## 5. Test (kế thừa framework hiện có)
- `tests/notes.test.ts`: case object ngay trong file + `runCaseSuite`; case mẫu: CRUD, chủ khác 404,
  validate 400, search/pagination, soft-delete → trash → restore → hard delete, share public không token,
  tag: gán/lọc/xoá. Chạy `npm test` (`:memory:`) + `npm run test:file`.
