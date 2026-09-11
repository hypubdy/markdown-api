# AI Agent Workflow — Markdown API

Tài liệu này là workflow chuẩn để một hoặc nhiều AI agent phát triển dự án Markdown API an toàn,
có kiểm chứng và không làm lệch contract hiện tại.

## 1. Bối cảnh dự án

### Stack và runtime

- Hono + TypeScript.
- Node local/test: SQLite qua `node:sqlite`.
- Cloudflare Worker production: Clerk + Cloudflare D1 binding `env.DB`.
- D1 schema: `d1/migrations/` và chạy bằng Wrangler.
- Test: Vitest, mặc định SQLite `:memory:`.
- Script: TypeScript chạy bằng `tsx`; không tạo thêm file `.mjs`.

### File quan trọng

| Khu vực | File/thư mục | Trách nhiệm |
|---|---|---|
| API | `src/modules/<feature>/` | `schemas`, `actions`, `routes` |
| Router | `src/modules/index.ts` | Mount route và middleware authenticate |
| Contract data | `src/data/*.repository.ts` | Interface, mapper, kiểu row |
| Node data | `src/data/*sqlite.repository.ts` | Local/test SQLite |
| Worker data | `src/data/*d1.repository.ts` | Production D1 |
| Worker entry | `src/worker.ts`, `src/app.worker.ts` | Cloudflare Worker |
| D1 | `d1/migrations/*.sql` | Schema migration |
| Deploy | `.github/workflows/deploy-cloudflare.yml` | Verify → migrate D1 → secrets → deploy |
| Tests | `tests/**/*.test.ts` | Integration và behavior contract |

### Nguồn sự thật

Khi tài liệu cũ mâu thuẫn với code/config hiện tại, ưu tiên theo thứ tự:

1. Contract API và test đang chạy.
2. Code hiện tại và `wrangler.jsonc`.
3. Tài liệu này.
4. Các tài liệu lịch sử trong `docs/`.

`docs/performance-report.md` là báo cáo nguyên nhân chậm của Supabase trước đây. Nó dùng để hiểu lý
do chuyển sang D1, không phải hướng dẫn runtime production hiện tại.

## 2. Contract nghiệp vụ bắt buộc

### Ownership và bảo mật

- User chỉ được thao tác note của chính mình.
- Truy cập note của user khác phải trả `404`, không tiết lộ note tồn tại.
- Admin không được tự động có quyền sửa/xóa note của user khác.
- Note bị xóa là soft-delete trước; hard-delete chỉ qua thùng rác.
- Public share không đi qua authenticate; mọi route private phải qua middleware phù hợp.
- Không ghi secret vào source, log, test output, commit hoặc tài liệu.

### API chính

| Nhóm | Endpoint | Quyền |
|---|---|---|
| Health | `GET /api/v1/health` | Public |
| Auth | `/api/v1/auth/*` | Theo `AUTH_PROVIDER` |
| Notes | `POST/GET /api/v1/notes` | Authenticated, owner |
| Note detail | `GET/PATCH/DELETE /api/v1/notes/:id` | Authenticated, owner |
| Raw/share | `/api/v1/notes/:id/raw`, `/share` | Authenticated, owner |
| Trash | `GET /api/v1/notes/trash`, `POST /api/v1/notes/trash/:id/restore`, `DELETE /api/v1/notes/trash/:id` | Authenticated, owner |
| Tags | `GET /api/v1/tags`, `DELETE /api/v1/tags/:name` | Authenticated, owner |
| Public | `GET /api/v1/public/notes/:shareToken` | Public |

Các route tĩnh như `/notes/trash` phải được khai báo trước `/notes/:id`.

### Data invariants

- Query note private luôn lọc `owner_id` và `deleted_at IS NULL`, trừ các method trash.
- `share_token` nullable nhưng unique khi có giá trị.
- Tag unique theo `(owner_id, name)`, không dùng chung giữa user.
- `list()` trả đầy đủ `content`, không nhúng tags; action tự gọi `findNoteTags()` khi cần.
- Chỉ `update()` bump `updated_at`; `setShareToken()`, `softDelete()` và `restore()` không được
  bump timestamp nội dung.
- Timestamp sau mapper luôn là ISO string.
- `COUNT`/`total` sau mapper luôn là number.
- `replaceNoteTags()` phải atomic trên D1 bằng `D1Database.batch()`.

## 3. Vai trò agent

Mỗi agent chỉ nhận một nhiệm vụ và phạm vi file rõ ràng.

### A — Spec Agent

Đầu vào: user story hoặc yêu cầu thay đổi.

Đầu ra:

- acceptance criteria có thể kiểm thử;
- danh sách route, input/output, lỗi và quyền;
- bảng edge case;
- danh sách file được phép sửa;
- quyết định có cần migration D1 hay không.

Cấm sửa code production hoặc sửa test để làm cho spec có vẻ đúng.

### B — Red/Test Agent

Viết test trước khi code production:

- test behavior, không test implementation detail;
- dùng case object/data-driven khi phù hợp;
- fixture tách biệt và kiểm tra ownership, 400/404/409;
- với repository, test trực tiếp interface trên SQLite `:memory:`;
- test D1-specific nên dùng Worker/D1 local, không trộn vào test SQLite mặc định.

Red chỉ được xem là hợp lệ khi fail vì chức năng chưa có, không phải vì syntax, fixture sai hoặc
môi trường thiếu cấu hình.

### C — Repository Agent

Implement tầng data theo thứ tự:

1. Cập nhật interface/type/mapper.
2. Cập nhật SQLite repository cho local/test.
3. Cập nhật D1 repository cho Worker.
4. Nếu schema thay đổi, tạo migration mới trong `d1/migrations/`; không sửa migration đã chạy remote.
5. Cập nhật factory tương ứng (`src/data/index.ts` hoặc `src/data/index.worker.ts`).
6. Dùng prepared statements; dùng `batch()` cho transaction hoặc nhiều thao tác liên quan.

Cấm đưa `node:sqlite`, `pg` hoặc Supabase client vào bundle Worker D1.

### D — API Agent

Implement theo thứ tự:

1. Zod schemas.
2. Actions và ownership check.
3. Route object và thứ tự route.
4. Mount vào `src/modules/index.ts`.
5. OpenAPI metadata nếu endpoint mới cần hiển thị Swagger.

`ApiError` phải được dùng cho lỗi nghiệp vụ; không trả lỗi DB thô cho client.

### E — Quality/Refactor Agent

Review sau khi test đã xanh:

- type safety và import đúng;
- không có `.mjs` mới;
- không có secret trong diff;
- không đổi API ngoài phạm vi;
- không có N+1 query không cần thiết;
- D1 batch/transaction và FK đúng;
- log không chứa password, token hoặc service key.

Agent này không tự đổi behavior để làm test pass.

### F — Integration/Release Agent

Kiểm tra runtime:

- Node SQLite local;
- Worker D1 local;
- D1 migration local/remote;
- Worker dry-run;
- GitHub Actions contract;
- smoke endpoint sau deploy nếu được cấp quyền.

Nếu Cloudflare API token thiếu quyền, báo blocker rõ ràng; không dùng token khác hoặc bypass bảo mật.

## 4. Quy trình thực hiện một feature

### Bước 0 — Khởi động và kiểm tra trạng thái

Trước khi sửa:

```bash
git status --short
rg --files src tests scripts docs
npm run typecheck
```

Đọc các file liên quan và giữ nguyên thay đổi có sẵn của người dùng. Không dùng `git reset --hard`,
`git checkout --` hoặc lệnh xóa diện rộng.

### Bước 1 — Chốt spec

Tạo một phiếu feature ngắn gồm:

```text
Goal:
API/contract:
Ownership/auth:
Data changes:
D1 migration required: yes/no
Files in scope:
Acceptance cases:
Risks:
```

Nếu yêu cầu còn mơ hồ nhưng không ảnh hưởng contract, chọn giả định nhỏ nhất và ghi rõ. Nếu ảnh hưởng
quyền, schema, dữ liệu production hoặc API public, phải dừng để xác nhận.

### Bước 2 — RED

Thêm test và chạy:

```bash
npm test -- --reporter=dot
```

Xác nhận test fail đúng lý do. Không chuyển sang Green nếu test đang fail vì setup hỏng.

### Bước 3 — GREEN

Implement ít nhất để test pass. Giữ thay đổi theo layer:

```text
repository/type/migration → action/schema → route/mount → docs
```

Không trộn refactor lớn, đổi auth provider hoặc đổi response contract vào feature không liên quan.

### Bước 4 — REFACTOR

Chạy review theo checklist:

- mọi private query có owner filter;
- route static đứng trước parameter route;
- D1 dùng `prepare().bind()`;
- thao tác nhiều câu lệnh dùng `batch()`;
- SQLite và D1 cùng giữ behavior contract;
- lỗi ownership trả 404;
- timestamp/null/count được map đúng;
- migration có tên tăng dần và chạy được nhiều lần theo cơ chế Wrangler.

### Bước 5 — Verification gate

Gate tối thiểu cho mọi feature:

```bash
npm run typecheck
npm test
npm run build
npm run build:worker
```

Nếu đụng schema D1:

```bash
npx wrangler d1 migrations apply markdown-api --local
```

Nếu đụng Worker runtime:

```bash
npm run dev:worker
# kiểm tra GET http://127.0.0.1:8787/api/v1/health
```

Không chạy `--remote` nếu user chưa yêu cầu thao tác dữ liệu Cloudflare thật.

### Bước 6 — Handoff

Mỗi agent phải trả:

```text
Changed files:
Behavior implemented:
Tests added/updated:
Commands run + result:
Known warnings:
Blockers / required user action:
```

## 5. Workflow schema và deploy D1

### Thay đổi schema

1. Spec Agent xác định migration cần thiết.
2. Tạo file mới, ví dụ `d1/migrations/0002_add_x.sql`.
3. Không sửa `0001_initial.sql` sau khi đã áp dụng remote.
4. Apply local và kiểm tra Worker.
5. Commit migration cùng code sử dụng schema.

### Deploy

`wrangler.jsonc` chứa binding `DB`, `database_name`, `database_id`, vars không bí mật và thư mục
migration. File này được commit.

Workflow `.github/workflows/deploy-cloudflare.yml` phải chạy theo thứ tự:

```text
checkout
→ npm ci
→ typecheck + test
→ wrangler d1 migrations apply markdown-api --remote
→ upload runtime secrets
→ deploy Worker
```

Không commit `.env`, `ENV_FILE`, API token, Clerk secret, JWT secret hoặc service key.

API token CI cần quyền Cloudflare phù hợp cho Workers và D1. Nếu migration remote lỗi authentication,
dừng release và báo thiếu quyền; không bỏ qua migration hoặc deploy code phụ thuộc schema chưa có.

## 6. Lệnh thường dùng

### Local Node/SQLite

```bash
npm run dev
npm run dev:local
npm test
npm run test:file
npm run seed
npm run typecheck
npm run build
```

### Local Worker/D1

```bash
npx wrangler d1 migrations apply markdown-api --local
npm run dev:worker
npm run build:worker
```

`npm run dev:worker` đã override `DB_DRIVER=d1`; `.env` có thể vẫn giữ `DB_DRIVER=sqlite` cho Node
local.

### Remote D1 và deploy

```bash
npx wrangler d1 migrations apply markdown-api --remote
npm run deploy
```

Chỉ chạy hai lệnh remote khi đã được user cho phép và token có quyền D1.

## 7. Definition of Done

- [ ] Acceptance criteria đã được chốt.
- [ ] Test RED đã fail đúng lý do trước khi implement.
- [ ] SQLite local/test và D1 Worker giữ cùng behavior contract.
- [ ] Ownership, auth, public share và soft-delete được kiểm tra.
- [ ] Migration D1 mới được tạo nếu schema thay đổi.
- [ ] `npm run typecheck` xanh.
- [ ] `npm test` xanh.
- [ ] `npm run build` xanh.
- [ ] `npm run build:worker` xanh.
- [ ] D1 local migration/Worker smoke đã chạy nếu feature chạm D1.
- [ ] Không có secret hoặc file `.mjs` mới trong diff.
- [ ] README/tài liệu liên quan được cập nhật.
- [ ] Handoff ghi rõ file, verification và blocker.

## 8. Prompt khởi động cho AI agent

Dùng prompt sau khi bắt đầu một feature:

```text
Bạn là AI agent trong dự án Markdown API.

Đọc docs/AI-AGENT-WORKFLOW.md và các tài liệu spec liên quan trước khi sửa code.
Feature: <mô tả feature>

Yêu cầu:
1. Xác định contract, ownership, API và data changes.
2. Liệt kê file trong scope trước khi sửa.
3. Làm RED → GREEN → REFACTOR.
4. Nếu đổi schema, tạo migration D1 mới; không sửa migration cũ.
5. Giữ SQLite local/test và D1 Worker cùng behavior.
6. Chạy các verification gate phù hợp.
7. Không tạo file .mjs và không đọc/in secret.
8. Kết thúc bằng changed files, tests, commands, warnings và blockers.
```

## 9. Prompt chạy toàn pipeline

```text
GO — chạy TDD pipeline cho <feature>.

Hãy tuần tự thực hiện:
Spec → Red → Green Repository/API → Refactor/Quality → Integration/Release.
Không chuyển phase khi gate trước đó chưa xanh. Nếu phát hiện spec mâu thuẫn với test hoặc code,
dừng và báo mâu thuẫn thay vì sửa test cho qua. Chỉ thao tác D1 remote khi được phép rõ ràng.
```
