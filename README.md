# Hono TypeScript Markdown API — Node + Cloudflare Workers

REST API lưu trữ Markdown viết bằng **Hono + TypeScript**, tổ chức theo module tính năng. Production chạy trên Cloudflare Workers với Clerk + Supabase PostgREST; Node local/test vẫn hỗ trợ SQLite và JWT nội bộ. Mọi thứ của một tính
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
├── supabase/schema.sql       # DDL tạo bảng trong Supabase (chạy 1 lần trong SQL Editor)
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
    │   ├── user.supabase.repository.ts # Supabase (PostgREST) — chạy thật, chạy được trên Worker
    │   ├── note.repository.ts #   interface NoteRepository (notes + tags) + mapper/DDL
    │   ├── note.sqlite.repository.ts  #   driver SQLite cho notes/tags/note_tags
    │   ├── note.supabase.repository.ts #   driver Supabase cho notes/tags/note_tags
    │   └── supabase.client.ts #   tạo PostgREST client (fetch-based, không TCP socket)
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
cp .env.example .env   # sửa JWT_SECRET tuỳ ý + điền SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY

npm run dev            # chạy dev — MẶC ĐỊNH dùng SUPABASE (tsx watch, tự reload)
npm run dev -- --local # (hoặc `npm run dev:local`) — chạy SQLITE, không cần DB server
npm run build          # đóng gói bằng esbuild → dist/server.js + dist/seed.js
npm start              # chạy bản build (dùng DB theo .env: mặc định supabase)
```

Import trong code dùng đường dẫn **không có đuôi file** (vd `from "./modules/index"`) nhờ
`moduleResolution: "Bundler"`; bản chạy thật được esbuild bundle (`--packages=external`),
còn dev (`tsx`) và test (`vitest`) vốn đã hỗ trợ sẵn — không cần viết `.js` ở đuôi import.

Yêu cầu: Node.js ≥ 22 cho SQLite local/test; Cloudflare Workers dùng runtime Fetch/Web Crypto.

## Deploy Cloudflare Workers

Production Worker dùng **Clerk** và **Supabase PostgREST**. Worker không bundle `node:sqlite`, `pg` hoặc bước tự tạo schema. Trước khi deploy, chạy `supabase/schema.sql` trong Supabase SQL Editor.

```bash
npm run dev:worker       # Wrangler local runtime
npm run build:worker     # dry-run bundle, không deploy
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put CLERK_PUBLISHABLE_KEY
npx wrangler secret put CLERK_SECRET_KEY
npm run deploy
```

Các giá trị không bí mật `NODE_ENV=production`, `AUTH_PROVIDER=clerk`, `DB_DRIVER=supabase` nằm trong `wrangler.jsonc`. Không commit service-role key hoặc Clerk secret.

## Xác thực: JWT nội bộ (`local`) hoặc Clerk SSO (`clerk`)

Chọn provider qua env `AUTH_PROVIDER` (`.env.example`):

| AUTH_PROVIDER | Cách đăng nhập | Frontend gửi gì trong `Authorization: Bearer …` |
|---|---|---|
| `local` (mặc định) | `POST /auth/login`, `POST /auth/register` → JWT nội bộ (JWT_SECRET) | JWT nội bộ |
| `clerk` | SSO qua Clerk (Google/GitHub…, bật ở Clerk Dashboard) | Clerk **session token** (lấy bằng `getToken()` phía client) |

Khi `AUTH_PROVIDER=clerk`:

- Backend verify chữ ký Clerk session token (JWKS, không cần gọi mạng cho mỗi request),
  rồi **tự đồng bộ tài khoản nội bộ theo email chính** của Clerk:
  đã có user trùng email (tạo bằng mật khẩu/SSO trước) → dùng luôn (giữ id, role, ghi chú);
  chưa có → tạo user mới với mật khẩu ngẫu nhiên (không login bằng mật khẩu được).
- Role lúc tạo user mới lấy từ **Clerk public metadata** `role` (`"admin"` → admin, ngược lại `user`).
  Muốn tài khoản SSO là admin: đặt metadata trên Clerk Dashboard, hoặc đổi role bằng API admin.
- `POST /auth/login` & `/auth/register` trả **410 Gone** (đăng nhập mật khẩu đã tắt —
  token JWT nội bộ sẽ không được `authenticate` chấp nhận ở chế độ này).
- Khi **không** có phiên Clerk hợp lệ: các route cần đăng nhập trả 401 chuẩn.
- **Lệch đồng hồ**: nếu máy chạy server chậm hơn server Clerk vài chục giây, Clerk
  từ chối token do claim `nbf` chưa tới giờ hiệu lực (`token-not-active-yet`).
  Dung sai mặc định **60 giây** (`CLERK_CLOCK_SKEW_MS`, đơn vị ms) — chỉnh lại nếu cần.

**Test chế độ Clerk** (mock `@clerk/express`, không gọi mạng):

```bash
npm run test:clerk    # chạy tests/clerk.test.ts với AUTH_PROVIDER=clerk + Clerk mock
```

## Cơ sở dữ liệu — SQLite (test/dev) và Supabase (chạy thật)

Toàn bộ action chỉ phụ thuộc **interface `UserRepository`** (`src/data/user.repository.ts`);
driver cụ thể do factory trong `src/data/index.ts` chọn theo biến môi trường:

| Môi trường    | DB_DRIVER  | Cấu hình                                                                 |
|---------------|------------|--------------------------------------------------------------------------|
| **Test**      | `sqlite`   | Ép buộc bởi `vitest.config.ts` (`DB_FILE=":memory:"`) — DB trong RAM, mỗi worker một DB sạch, không cần cài gì |
| **Dev (mặc định)** | `supabase` | `npm run dev` — chạy trên Supabase (PostgreSQL), tự tạo bảng nếu có `DATABASE_URL` |
| **Dev local** | `sqlite`   | `npm run dev -- --local` (hoặc `npm run dev:local`) — `DB_FILE=dev.sqlite`, không cần DB server |
| **Chạy thật** | `supabase` | `npm start`/`npm run seed` — `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (fetch-based) |

**Supabase** là PostgreSQL chạy trên nền tảng Supabase, được truy cập qua **PostgREST (HTTP)** —
driver dùng `@supabase/postgrest-js` (fetch) nên **không cần TCP socket như `pg`**, do đó **chạy được
trên Cloudflare Worker**. Bảng vẫn là PostgreSQL thật (có FK, index, transaction server-side).

**Cài Supabase (một lần):**

1. Tạo project tại [supabase.com](https://supabase.com) → lấy `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`
   ở **Project → Settings → API** (dùng key **service_role**, không dùng anon key).
2. Sửa `.env`:
   ```bash
   DB_DRIVER=supabase
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
   DATABASE_URL=postgresql://postgres:<DB_PASSWORD>@db.<project-ref>.supabase.co:5432/postgres
   npm run dev
   ```
   - Nếu đặt `DATABASE_URL`, app **TỰ TẠO BẢNG** (`users`/`notes`/`tags`/`note_tags`) lúc khởi động qua `pg`
     — giống driver cũ, không cần làm gì thêm.
   - Nếu **không** đặt `DATABASE_URL`, bạn phải tạo bảng trước bằng cách chạy
     [`supabase/schema.sql`](./supabase/schema.sql) trong **SQL Editor** (hoặc `supabase db push`).

> ⚠️ App tự quản lý auth bằng JWT riêng (không dùng Supabase Auth), nên schema.sql **tắt RLS** cho các
> bảng. Nếu bạn tự bật RLS, hãy tạo policy phù hợp (service_role vẫn bypass RLS nên app vẫn chạy được,
> nhưng các client lạ dùng anon key sẽ bị chặn).

**Seed dữ liệu demo** (`src/seed.ts`) — 15 user (2 admin + 13 user, mật khẩu `matkhau123`):

```bash
npm run seed         # thêm user demo còn thiếu (idempotent theo email, không xoá gì)
npm run seed:reset   # XOÁ hết user rồi seed lại từ đầu
```

Seed chạy trên driver đang chọn trong `.env` — Supabase hoặc SQLite đều được.

> 💡 **"Lỗi font chữ" khi seed/log**: dữ liệu trong DB (Supabase/SQLite) LUÔN là UTF-8 chuẩn
> (đã kiểm tra codepoint). Nếu console Windows hiện tên như `Ngu?n V?n An`, đó là do **console
> mặc định dùng codepage 850/1252**, không phải dữ liệu hỏng. `src/utils/utf8-console.ts` tự chạy
> `chcp 65001` khi khởi động seed/server để render đúng; nếu terminal của bạn vẫn sai, hãy dùng
> **Windows Terminal / VS Code terminal** (mặc định UTF-8) hoặc chạy `chcp 65001` trước.

Trong khi **test luôn chạy SQLite `:memory:`** (không cần DB server), **chạy thật dùng Supabase** —
vì đều phụ thuộc chung interface nên hành vi nghiệp vụ giống nhau. Nếu sau này thêm bảng mới, chỉ cần
thêm interface + 2 driver + factory — action không đổi dòng nào.

> Lưu ý về Cloudflare Worker: `@supabase/postgrest-js` dùng `fetch` không dùng `net`/`tls`, nên tầng dữ
> liệu này chạy được trong môi trường Worker. Bản thân Express server vẫn chạy Node (không đổi); để
> đưa cả app lên Worker cần entry/worker-format riêng (ngoài phạm vi thay đổi tầng dữ liệu).

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
qua HTTP trên SQLite nên driver Supabase (chỉ chạy khi nối Supabase thật) KHÔNG được nạp khi
test chạy SQLite → file `src/data/*.supabase.repository.ts` + `supabase.client.ts` được loại
khỏi coverage (xem `vitest.config.ts`); muốn đo chúng cần chạy test với `DB_DRIVER=supabase`.

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

- **Dữ liệu**: chuyển sang Supabase chỉ bằng env (`DB_DRIVER=supabase` + `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY`), nhớ tạo bảng bằng `supabase/schema.sql` trước. Khi mở rộng, thêm
  repository cho từng bảng (interface + driver sqlite/supabase) theo mẫu trong `src/data/`.
  Test luôn tự chạy SQLite `:memory:` nên không cần DB server.
- **Cloudflare Worker**: tầng dữ liệu dùng PostgREST (fetch) nên chạy được trên Worker. Đưa cả app
  lên Worker cần entry `fetch`-handler riêng (ngoài phạm vi tầng dữ liệu).
- **CORS**: cấu hình `app.use(cors({ origin: [...] }))` thay vì mở cho tất cả.
- **Bảo mật**: luôn đổi `JWT_SECRET`; cân nhắc refresh token + đenlist token.
- **Rate limiting**: thêm `express-rate-limit` cho các route auth.
