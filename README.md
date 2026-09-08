# Express TypeScript — chia theo Module (routes + actions) và Middleware

Dự án mẫu Express + TypeScript tổ chức theo **module theo tính năng**. Mọi thứ của một tính
năng đều nằm gọn trong thư mục module của nó:

- `<module>.routes.ts` — khai báo endpoint dưới dạng **object** (bảng route)
- `<module>.actions.ts` — logic nghiệp vụ của từng endpoint
- `<module>.schemas.ts` — schema validate **payload của request** trong module (body/params)

Middleware (xác thực, validate, log, lỗi...) nằm riêng ở `src/middleware/` và được dùng chung
cho mọi module.

## Cấu trúc thư mục

```
express-ts-app/
├── package.json
├── tsconfig.json
├── docker-compose.yml        # PostgreSQL local (docker compose up -d)
├── .env.example              # copy thành .env rồi sửa cho phù hợp
└── src/
    ├── server.ts             # Điểm khởi động: seed dữ liệu + listen + graceful shutdown
    ├── app.ts                # Ráp Express: middleware toàn cục → routes → 404 → error handler
    ├── config/
    │   └── env.ts            # Đọc & validate biến môi trường (zod)
    ├── modules/              # ★ MỖI MODULE = 1 THƯ MỤC: routes + actions + schemas
    │   ├── index.ts          #   Router gốc /api/v1 — ráp các module lại (createRouter)
    │   ├── auth/
    │   │   ├── auth.routes.ts    #   Bảng route dạng object { method, path, middlewares, action }
    │   │   ├── auth.actions.ts   #   register, login
    │   │   └── auth.schemas.ts   #   Schema zod validate payload (register/login)
    │   ├── user/
    │   │   ├── user.routes.ts    #   Bảng route dạng object
    │   │   ├── user.actions.ts   #   listUsers, getMe, getUserById, updateRole, deleteUser
    │   │   └── user.schemas.ts   #   Schema zod validate payload (id params, role)
    │   ├── notes/             #   App lưu markdown: CRUD, search, soft-delete/thùng rác, share
    │   ├── tags/              #   Tags theo user (GET /tags, DELETE /tags/:name)
    │   └── public/            #   GET /public/notes/:shareToken — KHÔNG cần đăng nhập
    ├── middleware/           # ★ DÙNG CHUNG CHO MỌI MODULE (chạy trước action)
    │   ├── authenticate.middleware.ts   #   kiểm tra JWT → gắn req.user
    │   ├── authorize.middleware.ts      #   phân quyền theo role
    │   ├── validate.middleware.ts       #   validate body/query/params bằng zod
    │   ├── request-logger.middleware.ts #   log mỗi request
    │   ├── not-found.middleware.ts      #   bắt route không tồn tại
    │   └── error-handler.middleware.ts  #   bắt MỌI lỗi, trả JSON chuẩn
    ├── data/                  # ★ TẦNG DỮ LIỆU: interface chung + 2 driver
    │   ├── index.ts           #   factory chọn driver theo env.DB_DRIVER + init/seed/close
    │   ├── user.repository.ts #   interface UserRepository + helper (hash, map dòng DB)
    │   ├── user.sqlite.repository.ts  #   SQLite (node:sqlite) — dùng cho TEST & dev nhanh
    │   ├── user.pg.repository.ts      #   PostgreSQL (pg) — dùng cho chạy thật
    │   ├── note.repository.ts #   interface NoteRepository (notes + tags) + mapper/DDL
    │   ├── note.sqlite.repository.ts  #   driver SQLite cho notes/tags/note_tags
    │   └── note.pg.repository.ts      #   driver PostgreSQL cho notes/tags/note_tags
    ├── utils/
    │   ├── router.ts         # ★ RouteTable + createRouter: biến object route thành Router
    │   ├── ApiError.ts, async-handler.ts, jwt.ts
    └── types/                # Kiểu TypeScript + mở rộng Express.Request
```

## Route khai báo dạng object như thế nào?

Trong `src/modules/user/user.routes.ts`:

```ts
export const userRoutes: RouteTable = {
  // key: tên route · value: cấu hình endpoint
  listUsers: { method: "get", path: "/", action: listUsers },
  getMe:     { method: "get", path: "/me", action: getMe },
  getUserById: {
    method: "get",
    path: "/:id",
    middlewares: [validate(idParamSchema)],        // middleware riêng của route
    action: getUserById,
  },
  updateRole: {
    method: "patch",
    path: "/:id/role",
    middlewares: [validate(updateRoleSchema), authorize("admin")],
    action: updateRole,
  },
  deleteUser: {
    method: "delete",
    path: "/:id",
    middlewares: [validate(idParamSchema), authorize("admin")],
    action: deleteUser,
  },
};
```

`RouteTable` và `createRouter()` định nghĩa trong `src/utils/router.ts`.
`createRouter()` tự:

1. gắn middleware **cấp module** (nếu truyền `{ middlewares: [...] }`),
2. đăng ký từng route theo thứ tự key,
3. bọc action bằng `asyncHandler` — action ném lỗi là tự động chảy về error-handler.

## Luồng xử lý một request

```
Client
  │  GET /api/v1/users
  ▼
[app.ts] helmet → cors → json → request-logger        (middleware toàn cục)
  ▼
[modules/index.ts] createRouter(userRoutes, { middlewares: [authenticate] })
  ▼
  └─ authenticate (middleware cấp module: xác thực JWT)
  ▼
  └─ listUsers (action trong modules/user/user.actions.ts)
  ▼
[app.ts] error-handler  ←── nếu action ném ApiError, lỗi tự động chảy về đây
```

## Thêm một module mới (ví dụ: `products`)

1. **Schema** (nếu có payload cần validate): tạo `src/modules/products/products.schemas.ts`:
   ```ts
   export const createProductSchema = z.object({
     body: z.object({ name: z.string().min(1), price: z.number().positive() }),
   });
   ```
2. **Action**: tạo `src/modules/products/products.actions.ts` — viết hàm async:
   ```ts
   export async function listProducts(_req: Request, res: Response) { ... }
   ```
3. **Route**: tạo `src/modules/products/products.routes.ts` — khai báo object:
   ```ts
   export const productRoutes: RouteTable = {
     list: {
       method: "get",
       path: "/",
       middlewares: [validate(createProductSchema)],
       action: listProducts,
     },
     // ...
   };
   ```
4. **Ráp vào** `src/modules/index.ts`:
   ```ts
   apiRouter.use("/products", createRouter(productRoutes));
   ```
   Nếu module cần đăng nhập: `createRouter(productRoutes, { middlewares: [authenticate] })`.

## Cài đặt & chạy

```bash
npm install
cp .env.example .env   # sửa JWT_SECRET tuỳ ý (mặc định đã có .env sẵn)

npm run dev            # chạy dev (tsx watch, tự reload)
npm run build          # đóng gói bằng esbuild → dist/server.js + dist/seed.js
npm start              # chạy bản build
```

Import trong code dùng đường dẫn **không có đuôi file** (vd `from "./modules/index"`) nhờ
`moduleResolution: "Bundler"`; bản chạy thật được esbuild bundle (`--packages=external`),
còn dev (`tsx`) và test (`vitest`) vốn đã hỗ trợ sẵn — không cần viết `.js` ở đuôi import.

Yêu cầu: Node.js ≥ 18.

## Cơ sở dữ liệu — SQLite (test/dev) và PostgreSQL (thật)

Toàn bộ action chỉ phụ thuộc **interface `UserRepository`** (`src/data/user.repository.ts`);
driver cụ thể do factory trong `src/data/index.ts` chọn theo biến môi trường:

| Môi trường    | DB_DRIVER  | Cấu hình                                                                 |
|---------------|------------|--------------------------------------------------------------------------|
| **Test**      | `sqlite`   | Ép buộc bởi `vitest.config.ts` (`DB_FILE=":memory:"`) — DB trong RAM, mỗi worker một DB sạch, không cần cài gì |
| **Dev nhanh** | `sqlite`   | `DB_FILE=dev.sqlite` (file, có trong `.env` mặc định) — không cần DB server |
| **Chạy thật** | `postgres` | `DATABASE_URL=postgres://user:pass@host:5432/db` — dùng driver `pg`        |

**PostgreSQL local bằng Docker** (mặc định `.env` đã trỏ tới container này):

```bash
npm run db:up        # = docker compose up -d — khởi động PG (volume giữ dữ liệu)
npm run dev          # chạy server nối PG qua DATABASE_URL trong .env
npm run db:down      # dừng container (dữ liệu vẫn còn trong volume)
npm run db:reset     # dừng và xoá CẢ volume dữ liệu (bắt đầu lại từ đầu)
```

Cấu hình nằm trong `docker-compose.yml` (postgres:16-alpine, cổng 5432, volume `pgdata`).
Bảng `users` tự được tạo lần đầu server khởi động (`initDatabase()`), tài khoản admin
`admin@example.com` / `admin123` được seed nếu chưa có.

**Seed dữ liệu demo** (`src/seed.ts`) — 15 user (2 admin + 13 user, mật khẩu `matkhau123`):

```bash
npm run seed         # thêm user demo còn thiếu (idempotent theo email, không xoá gì)
npm run seed:reset   # XOÁ hết user rồi seed lại từ đầu
```

Seed chạy trên driver đang chọn trong `.env` — PostgreSQL (docker) hoặc SQLite đều được.

```bash
# Chạy thật bằng PostgreSQL (sửa .env):
#   DB_DRIVER=postgres
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/express_app
npm run dev
```

SQLite dùng module `node:sqlite` tích hợp sẵn (Node ≥ 22.13) nên **không cần cài dependency
native** — đó là lý do test chạy trên SQLite rất dễ mock/khởi tạo. PostgreSQL chạy qua
package `pg`. Nếu sau này thêm bảng mới, chỉ cần thêm interface + 2 driver + factory —
action không đổi dòng nào.

## Kiểm thử (integration test)

```bash
npm test          # chạy 1 lần
npm run test:watch  # chạy và tự chạy lại khi sửa code
```

Bộ test viết theo kiểu **data-driven**: bảng test case (object) được khai báo NGAY TRONG
file test và chạy luôn trong file đó; chỉ phần code dùng chung được tách ra:

```
tests/
├── app.test.ts              # bảng test case auth & user + runCaseSuite() — chạy trong file
├── mock-token.test.ts       # prepare() fixture/token + bảng case + runCaseSuite()
├── notes.test.ts            # bảng case notes/trash/tags/public + runCaseSuite()
└── support/                 # code dùng chung (không phải file test)
    ├── run-case-suite.ts    #   runCaseSuite(): đăng ký describe + seed + chạy từng case
    ├── case-runner.ts       #   engine: chạy request, assert theo expect, resolve placeholder
    └── helpers.ts           #   signInAs (ký giả token), authBearer
```

Mỗi test case là một object thuần `{ name, method, path, body, expectedStatus, expect, save }`.
File test khai báo bảng case ngay trên đầu rồi gọi hàm dùng chung `runCaseSuite(cases, options)`
(`tests/support/run-case-suite.ts`) — hàm tự lo tạo app, seed dữ liệu, tạo engine và đăng ký
từng case thành một test theo thứ tự khai báo:

```ts
// vd: tests/app.test.ts — mở đầu file
const appCases: TestCase[] = [
  { name: "GET /health trả 200", method: "get", path: "/health", expectedStatus: 200, ... },
  // ... các object case khác
];

// cuối file — chạy luôn tại đây
runCaseSuite(appCases, { label: "API /api/v1 — auth & user" });
```

Suite chạy endpoint HTTP thật bằng supertest để middleware (`validate`/`authenticate`/
`authorize`) → action → error-handler chạy đúng như server thật. Giá trị động dùng
placeholder `"$adminToken"`, `"$userAEmail"`, `"$uniqueEmail"`... — lấy từ response của
case trước (trường `save`), từ biến khởi tạo trả về bởi `options.prepare()` (dùng cho
fixture/token cần chuẩn bị trước), hoặc sinh tự động. Muốn thêm test chỉ cần thêm một
object vào bảng case trong chính file test đó.

Lưu ý: các case trong cùng file dùng chung một DB nên chạy tuần tự theo thứ tự khai báo
(đã cấu hình trong `vitest.config.ts`).

**Coverage (%)**: `npm run coverage` — provider v8, in báo cáo text + sinh `coverage/index.html`
(xem trực quan trên trình duyệt) và `coverage/coverage-summary.json` (dùng cho CI).
Có ngưỡng bắt buộc (mặc định statements/lines/functions ≥ 70%, branches ≥ 50% — xem
`vitest.config.ts`) → lệnh **fail (exit ≠ 0)** nếu tụt dưới. Lưu ý: bộ test là integration
qua HTTP trên SQLite nên driver PostgreSQL hiển thị 0% là bình thường (không được nạp khi
test chạy SQLite); muốn đo driver PG cần chạy test với DB PG thật.

**Debug test với file SQLite**: mặc định test chạy trên `:memory:` (DB trong RAM, không có
file để mở xem). Khi cần debug dữ liệu, chạy file mode — DB là **file `test.sqlite` còn
nguyên sau khi chạy** để mở ra xem/kiểm tra:

```bash
npm run test:file                 # chạy toàn bộ test trên file test.sqlite (tuần tự)
TEST_DB_FILE=test.sqlite npx vitest run tests/app.test.ts   # chỉ 1 file test

# Xem dữ liệu còn lại trong file (node:sqlite, hoặc dùng sqlite3 CLI):
node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync('test.sqlite'); console.log(db.prepare('SELECT name,email,role FROM users').all());"
```

Ở file mode mỗi suite tự xoá dữ liệu cũ rồi seed lại (`seedDemoAdmin({ reset })`) nên kết
quả luôn xác định dù chạy lại nhiều lần; các file chạy tuần tự vì dùng chung một file DB.

### Mock token "đã đăng nhập" (không cần gọi login/register)

Xem `tests/mock-token.test.ts` + helper `signInAs()` trong `tests/support/helpers.ts`:
thay vì login thật lấy token, tự **ký giả** JWT bằng đúng `JWT_SECRET` của app
(`jwt.sign(payload, env.JWT_SECRET)` với `id/email/role` tuỳ chọn) — token vẫn qua
`jwt.verify()` của middleware `authenticate` thật. Dùng khi muốn test nhanh phân quyền
(`authorize`) hoặc route cần token với role bất kỳ. Lưu ý: action nào tra cứu DB theo
`req.user.id` (vd `GET /users/me`) cần user đó tồn tại — hãy tạo fixture bằng
`getUserRepository().create()` (trong `options.prepare()`) rồi ký token đúng id.

## API demo

Mọi route nằm dưới prefix `/api/v1`.

| Method | Path                    | Quyền | Mô tả |
|--------|-------------------------|-------|-------|
| GET    | `/health`               | công khai | Kiểm tra server |
| POST   | `/auth/register`        | công khai | Đăng ký `{name, email, password}` |
| POST   | `/auth/login`           | công khai | Đăng nhập `{email, password}` → nhận JWT |
| GET    | `/users`                | đã đăng nhập | Danh sách user. Lọc: `?role=admin\|user`, tìm theo tên/email: `?q=từ khoá` |
| GET    | `/users/stats`          | admin | Thống kê `{ total, admins, users }` |
| GET    | `/users/me`             | đã đăng nhập | Thông tin user hiện tại |
| GET    | `/users/:id`            | đã đăng nhập | Chi tiết user |
| GET    | `/users/:id/profile`    | đã đăng nhập | Hồ sơ công khai gọn nhẹ (không lộ email) |
| PATCH  | `/users/:id/role`       | admin | Đổi role `{role: "admin" \| "user"}` |
| DELETE | `/users/:id`            | admin | Xoá user (không xoá chính mình) |
| POST   | `/notes`                | đã đăng nhập | Tạo note `{title, content?, status?, tagNames?}` |
| GET    | `/notes`                | đã đăng nhập | Note của mình. Lọc: `?q=` (tên/nội dung), `?status=`, `?tag=`, `?page=&limit=` |
| GET    | `/notes/:id`            | chủ sở hữu | Chi tiết note (kèm `tags`); của người khác → 404 |
| GET    | `/notes/:id/raw`        | chủ sở hữu | Nội dung dạng `text/markdown` (cho editor) |
| PATCH  | `/notes/:id`            | chủ sở hữu | Sửa `{title?, content?, status?, tagNames?}` |
| DELETE | `/notes/:id`            | chủ sở hữu | Soft-delete (vào thùng rác) |
| GET    | `/notes/trash`          | đã đăng nhập | Danh sách note đã xoá mềm |
| POST   | `/notes/trash/:id/restore` | chủ sở hữu | Khôi phục note |
| DELETE | `/notes/trash/:id`      | chủ sở hữu | Xoá HẲN (không khôi phục được) |
| POST   | `/notes/:id/share`      | chủ sở hữu | Bật chia sẻ public → `{shareToken, url}` |
| DELETE | `/notes/:id/share`      | chủ sở hữu | Thu hồi chia sẻ |
| GET    | `/public/notes/:shareToken` | **công khai** | Xem note được chia sẻ (không cần đăng nhập) |
| GET    | `/tags`                 | đã đăng nhập | Tags của mình kèm `count` (chỉ note đang sống) |
| DELETE | `/tags/:name`           | đã đăng nhập | Xoá tag (không của mình/không tồn tại → 404) |

Tài khoản demo được tạo sẵn khi khởi động: `admin@example.com` / `admin123`.
Chạy `npm run seed` để thêm 15 user demo + **30 note markdown mẫu** (mỗi user 2 note, tag `demo`).

### Thử nhanh bằng curl

```bash
# 1. Đăng nhập lấy token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"an.nguyen@example.com","password":"matkhau123"}' \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).data.token))")

# 2. Xem note markdown demo đã seed
curl http://localhost:3000/api/v1/notes -H "Authorization: Bearer $TOKEN"

# 3. Xem raw markdown của một note
NOTE_ID=$(curl -s http://localhost:3000/api/v1/notes -H "Authorization: Bearer $TOKEN" \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).data[0].id))")
curl http://localhost:3000/api/v1/notes/$NOTE_ID/raw -H "Authorization: Bearer $TOKEN"
```

## Swagger / API docs

```bash
npm run dev   # rồi mở trình duyệt:
# UI:        http://localhost:3000/api-docs      (swagger-ui-express)
# Spec JSON: http://localhost:3000/api-docs.json
```

Spec OpenAPI 3.0.3 được **SINH TỰ ĐỘNG từ các bảng route** (single source of truth —
không có file spec khai báo tay):

- Mỗi route trong `*.routes.ts` mang field `openapi: { summary, schema, success, data, ... }`
  trong đó `schema` **chính là zod schema đang validate** (`{body, query, params}`).
- Generator `src/swagger/build.ts` đọc `apiMountGroups` (modules/index.ts) + từng route:
  method/path → path, `:id` → path parameter, query/body → chuyển zod → OpenAPI schema
  (zod-to-json-schema), `authenticated` cấp module → `security: bearerAuth`.
- `src/swagger/components.ts` giữ các JSON Schema dùng chung (`User`, `Note`, `TagCount`...)
  — route tham chiếu bằng `data: { $ref: "#/components/schemas/Note" }`.

Thêm/mô tả endpoint mới chỉ cần sửa ngay trong `*.routes.ts` (summary + schema), spec cập nhật
theo — không bao giờ lệch với validate thật. Trên UI dùng nút **Authorize** dán
`Bearer <token>` (lấy từ login) để gọi API.

## Ghi chú nâng cấp lên production

- **Dữ liệu**: chuyển sang PostgreSQL chỉ bằng env (`DB_DRIVER=postgres` + `DATABASE_URL`).
  Khi mở rộng, thêm repository cho từng bảng (interface + driver sqlite/pg) theo mẫu
  trong `src/data/`. Test luôn tự chạy SQLite `:memory:` nên không cần DB server.
- **CORS**: cấu hình `app.use(cors({ origin: [...] }))` thay vì mở cho tất cả.
- **Bảo mật**: luôn đổi `JWT_SECRET`; cân nhắc refresh token + đenlist token.
- **Rate limiting**: thêm `express-rate-limit` cho các route auth.
