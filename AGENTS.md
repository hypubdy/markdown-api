# Markdown API — Codex project instructions

Đây là instruction chính của repository. Trước khi xử lý task, đọc
`docs/AI-AGENT-WORKFLOW.md` và chỉ đọc thêm các tài liệu trong `docs/` liên quan
đến phạm vi task.

## Quy tắc bắt buộc

- Giữ nguyên thay đổi sẵn có của người dùng; kiểm tra `git status --short` trước khi sửa.
- Không dùng `git reset --hard`, `git checkout --` hoặc lệnh xóa diện rộng.
- Dự án dùng TypeScript/`tsx`; không tạo file `.mjs` mới.
- Node local/test dùng SQLite; Cloudflare Worker production dùng Clerk + Cloudflare D1.
- Khi thay đổi schema, tạo migration mới trong `d1/migrations/`; không sửa migration đã chạy remote.
- Private query phải lọc `owner_id`; truy cập resource của user khác trả `404`.
- Không đọc, in, commit hoặc đưa secret vào source, log, test output hay tài liệu.
- Không chạy thao tác Cloudflare remote, migration `--remote` hoặc deploy nếu user chưa yêu cầu rõ.

## Workflow cho task có thay đổi code

Thực hiện theo thứ tự:

`Spec → Red → Green → Refactor → Verification → Handoff`

1. Nêu ngắn gọn goal, contract, quyền truy cập, data/migration, file trong scope và acceptance criteria.
2. Viết hoặc cập nhật test behavior trước; xác nhận test fail đúng nguyên nhân khi feature mới.
3. Implement theo layer: repository/type/migration → action/schema → route/mount → docs.
4. Review ownership, route order, D1 prepared statements/batch, parity SQLite-D1, timestamp/count mapper và secret safety.
5. Chạy gate phù hợp. Với feature thông thường, ưu tiên:

   ```bash
   npm run typecheck
   npm test
   npm run build
   npm run build:worker
   ```

   Nếu chạm D1 schema, chạy migration local; nếu chạm Worker runtime, chạy Worker local và health check.
6. Kết thúc bằng changed files, behavior, tests/commands + kết quả, warnings và blockers.

Task đọc-only hoặc thay đổi tài liệu nhỏ chỉ cần kiểm tra tương xứng; không chạy toàn bộ pipeline nếu không cần.

## Nguồn sự thật

Khi tài liệu cũ mâu thuẫn với code/config hiện tại, ưu tiên:

1. API contract và test đang chạy.
2. Code hiện tại và `wrangler.jsonc`.
3. `docs/AI-AGENT-WORKFLOW.md`.
4. Các tài liệu lịch sử khác trong `docs/`.

Sau khi đọc file này, mọi task trong repository phải tuân theo workflow chi tiết ở
[`docs/AI-AGENT-WORKFLOW.md`](docs/AI-AGENT-WORKFLOW.md).
