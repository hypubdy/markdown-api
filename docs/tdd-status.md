# TDD STATUS — Backend Markdown (nhật ký pipeline)

## Phase 1+2 (gộp) — HOÀN THÀNH
Spec → Red(2 lần, lần 1 bị loại vì lệch chuẩn) → Green → Gate → Integration PG.
- tests/notes.test.ts ban đầu 38 case; **75/75**; 4 bảng PG; end-to-end xanh.

## Phase 4 (slice bổ sung) — HOÀN THÀNH
- RED: thêm 12 case (xoá tag: chủ → 200; tag khác user/không tồn tại → 404; validate title/limit/uuid; dọn note3).
  50 test: 48 pass / 2 fail đúng lý do (removeTag luôn trả 200).
- GREEN: `removeTag` → `Promise<boolean>` (2 driver), action ném 404 khi không xoá được.
- **87/87** (app 31 + mock-token 6 + notes 50) ở cả `npm test` lẫn `test:file`; typecheck, build OK.

## Phase 5 (seed + README) — HOÀN THÀNH
- `src/seed.ts`: reset dọn notes→users (FK); seed **notes markdown mẫu** (2 note/user, tag "demo", status published) — idempotent.
- PG: 30 notes / 16 tags / 30 note_tags; chạy lại seed = 0 mới.
- README: cây thư mục (modules notes/tags/public, data note.*, tests/notes.test.ts), bảng API đầy đủ, curl demo note.
- Demo thật: an.nguyen login → 2 note seed; `/notes/:id/raw` → `text/markdown`; `/tags` → [{demo, count 2}].

## Phase 3 (còn MỞ — chờ quyết định)
- GET /notes hiện trả **mảng phẳng** (khớp contract test hiện có).
- Plan gốc đề xuất `{ data, pagination: {page, limit, total, pages} }` → cần đổi contract + test nếu muốn.

## Tổng kết pipeline
- Suite: 87 test (3 file test, đều data-driven HTTP, bảng case trong file).
- API mới hoàn chỉnh: notes CRUD + search/lọc + raw + trash/restore/hard-delete + share/public + tags.
- Quyền: chỉ owner (404 cho người khác); admin không can thiệp note.
