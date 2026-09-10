# Báo cáo: vì sao mọi API đều trả chậm?

Ngày đo: 2026-09-10 · Máy: Windows, Node v24.16.0 · DB: Supabase `zqvporpiqepdtkycauhq` (origin ap-southeast-1)

## TL;DR

Độ trễ **không nằm ở code app**. Chạy cùng source với SQLite: mọi endpoint **1–20ms**.
Chậm là do **mỗi thao tác DB là một vòng HTTPS tới Supabase PostgREST**, và mỗi vòng tốn
**~90–150ms** (lúc xấu 300–2500ms). App lại gọi **1 → 20+ vòng như vậy cho mỗi request**,
trong đó nhóm ghi (tag) gọi **tuần tự** nên độ trễ nhân lên.

| Đường đi tới DB | Chi phí / 1 query |
|---|---|
| SQLite (`node:sqlite`, cùng process) | **~0,1ms** |
| Postgres qua `pg` (TCP, connection đã mở) | **~36ms** |
| **Supabase PostgREST (app đang dùng)** | **~90–150ms**, đỉnh 500–2500ms |

---

## 0. "Chạy local chỉ connect trực tiếp Supabase Singapore, sao lại chậm?"

Vì **app KHÔNG connect trực tiếp tới Postgres ở Singapore**. Hai hostname khác nhau, hai đích đến khác nhau:

```
zqvporpiqepdtkycauhq.supabase.co      → 104.18.38.10, 172.64.149.246   = IP anycast của CLOUDFLARE
db.zqvporpiqepdtkycauhq.supabase.co   → 2406:da18:1691:a201::53d5      = AWS ap-southeast-1 (Singapore)
```

`scripts/probe-path.ts` xác nhận: 2 IP của `*.supabase.co` nằm trong danh sách CIDR chính thức của
Cloudflare (`api.cloudflare.com/client/v4/ips`), header trả về có `cf-ray: ...-HKG`.
Tức request của bạn đi: **máy dev → Cloudflare edge (HKG) → origin Supabase → Postgres**, rồi quay lại.

| Đường đi | RTT mở socket | Query thật |
|---|---:|---:|
| `*.supabase.co:443` (qua Cloudflare edge) | 29ms | – |
| `db.<ref>.supabase.co:5432` (Postgres trực tiếp) | 36ms | **37ms** |

Đo 20 mẫu liên tiếp một query thật, tách bằng header `x-envoy-upstream-service-time` (thời gian **Supabase tự báo**):

```
TTFB trung vị        : 290ms
  ├─ phần mạng        :  74ms   ← chặng Cloudflare edge ↔ origin
  └─ Supabase xử lý   : 216ms   ← 30ms … 660ms, đỉnh đo được 1704ms
```

So sánh cùng lúc, cùng query `SELECT id FROM notes LIMIT 1`:

| Đường đi | connect | query trung vị | query max |
|---|---:|---:|---:|
| **A. PostgREST HTTPS** (app đang dùng) | keep-alive | **227ms** | 364ms |
| B. `pg` trực tiếp `db.<ref>.supabase.co` | 490ms (1 lần) | **37ms** | 53ms |
| C. `pg` qua pooler `aws-1-…pooler.supabase.com` | 459ms (1 lần) | **64ms** | 322ms |

➡️ **A chậm hơn B 6,1×** cho cùng một query, cùng một DB, cùng một máy.
➡️ Ngay cả khi mạng hoàn hảo, mỗi query vẫn tốn thêm ~150ms do **phía Supabase tự báo chậm chập chờn**
(30ms → 1704ms). Đây là vấn đề của project Supabase (free/shared tier, connection pool), **không phải máy local**.

Nói ngắn: "chạy local" chỉ có nghĩa là **máy bạn** không tốn CPU. Còn mỗi thao tác DB vẫn phải:
(1) đi vòng qua Cloudflare edge, và (2) chờ Supabase xử lý. Nhân với 1–20 query/request ⇒ API chậm.

---

## 1. Đo thực tế: SQLite vs Supabase (cùng code, cùng máy)

Chạy 2 server từ cùng bản build, chỉ khác `DB_DRIVER` (`AUTH_PROVIDER=local` để đo được endpoint cần token):

```
tsx scripts/bench-api.ts --base http://localhost:3100   # SQLite
tsx scripts/bench-api.ts --base http://localhost:3101   # Supabase
```

| Endpoint | SQLite | Supabase | Chênh |
|---|---:|---:|---:|
| `GET /api/v1/notes` | 5,2ms | **287ms** | 55× |
| `GET /api/v1/notes?tag=bench` | 3,7ms | **389ms** | 105× |
| `GET /api/v1/tags` | 2,3ms | **173ms** | 75× |
| `GET /api/v1/users/me` | 1,7ms | **95ms** | 56× |
| `GET /api/v1/notes/:id` | 1,6ms | **170ms** | 106× |
| `GET /api/v1/notes/:id/raw` | 2,9ms | **116ms** | 40× |
| `POST /api/v1/notes` (không tag) | 10,9ms | **207ms** | 19× |
| `POST /api/v1/notes` (3 tag) | 19,5ms | **882ms** | 45× |
| `POST /api/v1/notes` (6 tag) | 15,0ms | **1405ms** | 94× |
| `POST /api/v1/auth/login` | 112ms | **363ms** | bcrypt ~110ms + 1 query |

➡️ Toàn bộ middleware (Hono, CORS, zod, swagger, `env` proxy) + routing chỉ tốn **~2–5ms**
(đó là toàn bộ thời gian của chế độ SQLite). Nút thắt 100% nằm ở tầng truy cập Supabase.

## 2. Bóc tách độ trễ Supabase: nằm ở đâu?

```
tsx scripts/probe-timing.ts
```

| Request | TTFB (client thấy) | `x-envoy-upstream-service-time` (Supabase tự báo) |
|---|---:|---:|
| `GET /rest/v1/` (không đụng DB) | **42ms** | – |
| `GET /rest/v1/notes?select=id&limit=1` | **94–105ms** | **1–2ms** |
| `GET /rest/v1/tags?select=id&limit=1` | **147–156ms** | 3ms |
| (lần đo khác, lúc Supabase nghẽn) | **668ms** | **510ms** |

Kết luận:
- Supabase xử lý query chỉ **1–3ms** → Postgres và PostgREST **không** chậm.
- Nhưng client phải trả **~90–150ms** cho đường mạng: `máy dev → Cloudflare edge HKG (42ms) → origin Supabase (Singapore) → quay lại`.
- Thỉnh thoảng phía Supabase tự báo **510ms** cho cùng 1 query → có **spike**, đẩy p95 lên 700–2700ms.
- So sánh: `pg` mở thẳng TCP tới Postgres cùng region chỉ **36ms/query** (`scripts/probe-pg.ts`).

Header xác nhận: `cf-ray: ...-HKG`, `x-envoy-upstream-service-time`, `sb-gateway-version: 2`.

## 3. Nguyên nhân thứ hai: số vòng round-trip bị nhân lên

Với `Supabase*Repository`, mỗi lời gọi repo = 1 request HTTP:

| Endpoint | Số round-trip | Ghi chú |
|---|---:|---|
| `GET /users/me` | 1 | |
| `GET /notes/:id/raw` | 1 | |
| `GET /notes/:id` | 2 | `findById` + `findNoteTags` |
| `GET /tags` | 1 | query nested `note_tags(tags(name))` nặng hơn |
| `GET /notes` | **1 + N** | 1 list (kèm COUNT) + N × `findNoteTags` — chạy song song (`Promise.all`) |
| `GET /notes?tag=x` | **3 + N** | thêm 2 query `resolveTagNoteIds` |
| `POST/PATCH /notes` có K tag | **4 + 2K…3K** | `replaceNoteTags` chạy **TUẦN TỰ**: check live → xoá link → mỗi tag: select tag → (insert tag) → upsert link |
| `authenticate` khi `AUTH_PROVIDER=clerk` | **+1** | mọi request cần token đều `findByClerkUserId` |

Bằng chứng tuyến tính — mỗi tag cộng thêm ~200ms (≈2–3 round-trip × ~90ms):

```
POST /api/v1/notes (không tag)   207ms
POST /api/v1/notes (3 tag)       882ms     +675ms  ≈ 3 × 225ms
POST /api/v1/notes (6 tag)      1405ms    +1198ms  ≈ 6 × 200ms
```

➡️ Vì vậy "API nào cũng chậm": endpoint rẻ nhất cũng 1 round-trip (~95ms), endpoint list/gắn tag
thì 5–20 round-trip (~0,3–1,4s), cộng spike thì thành vài giây.

## 4. Những thứ KHÔNG phải nguyên nhân (đã đo, loại trừ)

- **Middleware/Hono/zod/routing**: ~2–5ms (bằng chứng: toàn bộ endpoint ở chế độ SQLite).
- **`env` proxy** (`src/config/env.ts` gọi `safeParse` lại toàn bộ `process.env` mỗi lần đọc 1 thuộc tính): **21µs/lần đọc** → ~0,1ms/request. Lãng phí nhưng không gây chậm. Nên cache lại.
- **bcrypt**: ~110ms cho login/register — đúng thiết kế (cost 10), chỉ ảnh hưởng 2 endpoint.
- **Mạng nội bộ/Internet nói chung**: 27ms tới Cloudflare, 42ms tới edge Supabase → bình thường.
- **Nghẽn connection pool PostgREST**: 10 request song song xong trong 215ms → không serialize.
- **Clerk middleware**: request không token trả 401 trong 2–4ms → không gọi mạng.

## 5. Đề xuất sửa (theo thứ tự hiệu quả/công sức)

1. **Giảm số round-trip (nhanh, an toàn, không đổi hạ tầng)**
   - `GET /notes`: bỏ N+1 — lấy tag của cả trang bằng **1 query** (`note_tags` lọc `note_id IN (...)`) rồi gom trong JS.
   - `replaceNoteTags()` (Supabase): **1 query** `select` các tag đã có theo `owner_id, name IN (...)` + **1 insert** các tag thiếu + **1 upsert** toàn bộ link — thay cho vòng lặp per-tag. Ước tính `POST /notes` 6 tag từ 1,4s → ~0,4s.
   - `resolveTagNoteIds`: gộp 2 query thành 1 (`note_tags?select=note_id&tags.owner_id=eq.X&tags.name=eq.Y`).
2. **Cache lớp auth**: `findByClerkUserId` đang tốn 1 round-trip cho **mọi** request. Cache ngắn hạn (Map TTL 30–60s) hoặc tin `sub`/`email` trong session token.
3. **Node: thêm driver `pg` + `Pool`** (đã có sẵn `pg` cho DDL) và chỉ dùng PostgREST cho Cloudflare Worker. Đo được **37ms/query** thay vì **227ms** ⇒ **nhanh ~6×**, và ổn định (max 53ms thay vì spike 1,7s).
4. **Kiểm tra project Supabase**: phần `Supabase xử lý` dao động 30ms → 1704ms cho cùng một query `LIMIT 1` là bất thường. Nên xem region/compute, hoặc nâng khỏi mức free/shared — đây là phần **không thể sửa từ phía code app**.
5. **Việc nhỏ nên dọn**: prepare sẵn statement trong `SqliteUserRepository.findByClerkUserId/setClerkUserId` và `SqliteNoteRepository.list/listTagsWithCount` (đang `db.prepare()` mỗi lần gọi); cache `readEnv()`.

## 6. Cách chạy lại

> App đã có **log query tích hợp** (mỗi request in ra `queries=N dbMs=X slowQueries=Y`),
> không cần script đo nữa — xem mục "Logging" trong README. Log này cũng là thứ chứng minh
> trực tiếp kết luận ở trên: `GET /notes` in ra `queries=21 dbMs=7308ms`.

```bash
npm run build                     # hoặc: npm run dev / npm run dev:local

# Server đo (AUTH_PROVIDER=local để lấy được token khi không có Clerk)
$env:AUTH_PROVIDER="local"; $env:DB_DRIVER="sqlite";   $env:PORT=3100; node dist/server.js
$env:AUTH_PROVIDER="local"; $env:DB_DRIVER="supabase"; $env:PORT=3101; node dist/server.js

tsx scripts/bench-api.ts  --base http://localhost:3101 --n 15   # bảng độ trễ mọi endpoint
tsx scripts/bench-unauth.ts --base http://localhost:3102        # chế độ Clerk, không cần token
tsx scripts/probe-path.ts                                       # local connect ĐI ĐÂU (DNS/IP/RTT)
tsx scripts/probe-jitter.ts 20                                  # tách "mạng" vs "Supabase xử lý"
tsx scripts/probe-compare.ts                                    # PostgREST vs pg trực tiếp vs pooler
tsx scripts/probe-timing.ts                                     # tách DNS/TCP/TLS/TTFB
tsx scripts/probe-postgrest-overhead.ts                         # PostgREST vs không-DB vs song song
tsx scripts/probe-pg.ts                                         # connect + query qua pg
```

> Lưu ý: `tsx`/`npm run dev` không chạy được trong sandbox của phiên này (esbuild spawn bị EPERM),
> nên phần đo dùng `npm run build` + `node dist/server.js` — cùng code, chỉ khác loader.
