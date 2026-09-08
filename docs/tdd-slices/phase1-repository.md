# SLICE SPEC — Phase 1: Tầng dữ liệu Notes/Tags (Repository)

> Nguồn: `docs/BACKEND-PLAN.md` — mục 2 (Model dữ liệu), mục 4 (Phase 1) + `docs/TDD-WORKFLOW.md`.
> Vai trò người dùng spec này: **Red Agent** (viết test đỏ) và **Green Agent (Repository)** (implement).
> Phạm vi file spec này: **CHỈ tầng dữ liệu** — interface, type, mapper, DDL, factory, case test repository-level.
> KHÔNG đụng: route/action/schema/module (Phase 2), seed (Phase 5), file test HTTP (Phase 4).
> Pattern phải bám: `src/data/user.repository.ts` + `user.sqlite.repository.ts` + `user.pg.repository.ts` + `src/data/index.ts`.

---

## 0. Ràng buộc bất biến (contract dùng chung cho mọi method)

| # | Quy tắc | Áp dụng cho |
|---|---|---|
| R1 | Mọi truy vấn **list/detail** mặc định lọc `owner_id = ? AND deleted_at IS NULL` (note "còn sống") | `findById`, `list`, `update`, `softDelete`, `setShareToken`, `findByShareToken`, count của `listTagsWithCount` |
| R2 | Mọi method nhóm Notes **bắt buộc nhận `ownerId`** và ghép `owner_id` vào WHERE → note của người khác trả `null`/`false` như thể KHÔNG tồn tại (không lộ dữ liệu chéo) | tất cả method notes (trừ `findByShareToken` — public) |
| R3 | `id` luôn là `randomUUID()` sinh ở repository; timestamp lưu/lấy dạng ISO string; sau khi map `createdAt`/`updatedAt` luôn là `string` | mọi bản ghi notes/tags |
| R4 | `share_token` là cột **NULL UNIQUE** — nhiều note `NULL` (chưa share) là hợp lệ; chỉ 1 note có thể giữ 1 token | notes |
| R5 | Tag thuộc về **đúng 1 user** (không share chéo): `UNIQUE(owner_id, name)`; mọi thao tác tag đều đi kèm ownerId (trừ `findNoteTags`, xem §1.2) | tags |
| R6 | Kết quả `list` trả `Note[]` **đầy đủ `content`**, KHÔNG nhúng mảng `tags` — layer action tự load tag qua `findNoteTags(noteId)` | list/findById |
| R7 | Chỉ `update(...)` làm bump `updated_at`. `softDelete` chỉ set `deleted_at`; `restore` chỉ xoá `deleted_at`; `setShareToken` KHÔNG đổi timestamp (không phải sửa nội dung) | mọi method |
| R8 | `status` hợp lệ: `"draft" | "published"` (đã có CHECK ở DB — mức type đã chặn từ action) | notes |

---

## 1. Interface `NoteRepository` — file `src/data/note.repository.ts`

File mới này chứa (theo đúng pattern `user.repository.ts`): các **type row thô** (snake_case),
**interface `NoteRepository`**, **mapper** `mapNoteRow`/`mapTagNameRow`, hằng **DDL dùng chung cho SQLite**
và hằng `NOTE_SELECT_COLUMNS`. Driver PG sẽ import mapper + tự viết DDL `TIMESTAMPTZ` riêng (như `user.pg.repository.ts`).

### 1.1. Khối khai báo file

```typescript
// src/data/note.repository.ts
import type {
  CreateNoteInput,
  Note,
  NoteListFilters,
  NoteListResult,
  NoteStatus,
  TagCount,
  UpdateNoteInput,
} from "../types/index";

/** Một dòng thô của bảng notes do DB trả về (cột snake_case) */
export interface NoteRow {
  id: string;
  owner_id: string;
  title: string;
  content: string;
  status: string; // "draft" | "published"
  deleted_at: string | Date | null; // NULL = còn sống
  share_token: string | null;        // NULL = chưa public
  created_at: string | Date;
  updated_at: string | Date;
}

/** Một dòng thô trả về khi đếm tag theo note (JOIN tags) */
export interface TagNameRow {
  name: string;
}

/** Cột SELECT dùng chung cho cả 2 driver (không dùng SELECT *) */
export const NOTE_SELECT_COLUMNS =
  "id, owner_id, title, content, status, deleted_at, share_token, created_at, updated_at";
```

### 1.2. Interface (chữ ký ĐẦY ĐỦ — là hợp đồng bắt buộc)

```typescript
export interface NoteRepository {
  /** Tạo bảng notes/tags/note_tags nếu chưa có + chuẩn bị câu lệnh (chạy 1 lần). */
  init(): Promise<void>;

  // ── Notes ────────────────────────────────────────────────────────────
  /** Tạo note mới (tự sinh id; content? → '', status? → 'draft'); trả Note đã lưu. */
  create(input: CreateNoteInput): Promise<Note>;

  /** Note SỐNG theo (ownerId, id); sai owner / không tồn tại / đã soft-delete → null. */
  findById(ownerId: string, id: string): Promise<Note | null>;

  /**
   * Danh sách note SỐNG của owner, lọc tuỳ chọn q/status/tag, phân trang.
   * - q: title HOẶC content chứa chuỗi (LIKE '%q%', không phân biệt hoa thường)
   * - status: lọc đúng trạng thái
   * - tag: chỉ note đang mang tag tên = `tag` (của chính owner)
   * - page ≥ 1 (mặc định 1), limit 1..100 (mặc định 10)
   * - items sắp theo updated_at DESC; total = tổng note SỐNG thoả bộ lọc (không đổi theo page)
   */
  list(filters: NoteListFilters): Promise<NoteListResult>;

  /** Danh sách note ĐÃ soft-delete của owner (deleted_at IS NOT NULL). */
  listTrash(ownerId: string): Promise<Note[]>;

  /** Sửa một phần {title?, content?, status?} của note SỐNG; bump updated_at; null nếu không hợp lệ. */
  update(
    ownerId: string,
    id: string,
    changes: UpdateNoteInput,
  ): Promise<Note | null>;

  /** Đánh dấu xoá mềm (set deleted_at = now); true chỉ khi note SỐNG thuộc owner vừa bị xoá. */
  softDelete(ownerId: string, id: string): Promise<boolean>;

  /** Khôi phục từ thùng rác (xoá deleted_at); trả Note hoặc null nếu không phải note đã xoá của owner. */
  restore(ownerId: string, id: string): Promise<Note | null>;

  /** Xoá HẲN dòng (không quan tâm deleted_at); true khi có dòng thuộc owner bị xoá. */
  hardDelete(ownerId: string, id: string): Promise<boolean>;

  /**
   * Đặt token public share (token = null → THU HỒI share). Chỉ note SỐNG của owner.
   * KHÔNG bump updated_at. Token trùng note khác → DB ném lỗi UNIQUE (action phải sinh token mới).
   */
  setShareToken(
    ownerId: string,
    id: string,
    token: string | null,
  ): Promise<Note | null>;

  /** Tra note theo share_token (public — KHÔNG cần ownerId); note đã soft-delete → null. */
  findByShareToken(token: string): Promise<Note | null>;

  // ── Tags ─────────────────────────────────────────────────────────────
  /**
   * Tags của owner kèm count = số note ĐANG SỐNG mang tag đó.
   * Chỉ trả về tag có ≥ 1 note sống (JOIN nội); sắp theo name ASC.
   */
  listTagsWithCount(ownerId: string): Promise<TagCount[]>;

  /**
   * Gán lại toàn bộ tag cho note: xoá hết link cũ → upsert từng tag (theo ownerId) → link lại.
   * names = [] → chỉ xoá hết link. Note không tồn tại / không thuộc owner / đã soft-delete → no-op (không throw).
   * Thao tác ATOMIC (transaction ở cả 2 driver).
   */
  replaceNoteTags(
    ownerId: string,
    noteId: string,
    names: string[],
  ): Promise<void>;

  /** Xoá HẲN tag (theo ownerId + name); link note_tags tự xoá theo CASCADE; idempotent (không throw nếu tag chưa có). */
  removeTag(ownerId: string, name: string): Promise<void>;

  /**
   * Danh sách tên tag của 1 note (sorted ASC). KHÔNG lọc owner — là tiện ích đọc cho caller
   * đã chứng minh quyền sở hữu note (Phase 2 gọi sau findById(ownerId, id)); note không tag → [].
   */
  findNoteTags(noteId: string): Promise<string[]>;
}
```

> Lưu ý 1.1 — `init()` được thêm vào interface để khớp pattern `UserRepository.init()` và để
> `initDatabase()` gọi tạo bảng; không phải method nghiệp vụ.
> Lưu ý 1.2 — Không thêm method dọn dẹp hàng loạt vào interface: `clearAllNotes()` sống ở factory (§5)
> để giữ contract repository tối thiểu, giống `clearAllUsers()` ở `index.ts`.

---

## 2. Kiểu dữ liệu — bổ sung vào `src/types/index.ts` (cạnh `User`)

```typescript
export type NoteStatus = "draft" | "published";

/** Bản ghi note ở tầng ứng dụng (camelCase, timestamp đã chuẩn hoá ISO string) */
export interface Note {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  status: NoteStatus;
  /** null = còn sống; có giá trị = đang ở thùng rác */
  deletedAt: string | null;
  /** null = chưa public share */
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Dữ liệu tạo note mới */
export interface CreateNoteInput {
  ownerId: string;
  title: string;
  content?: string;   // thiếu → lưu ''
  status?: NoteStatus; // thiếu → 'draft'
}

/** Bộ lọc + phân trang cho NoteRepository.list() */
export interface NoteListFilters {
  ownerId: string;
  q?: string;      // tìm trong title/content
  status?: NoteStatus;
  tag?: string;    // tên tag chính xác
  page: number;    // ≥ 1
  limit: number;   // 1..100
}

/** Kết quả list() — total không phụ thuộc page/limit */
export interface NoteListResult {
  items: Note[];
  total: number;
}

/** Dữ liệu sửa một phần note */
export interface UpdateNoteInput {
  title?: string;
  content?: string;
  status?: NoteStatus;
}

/** Một tag kèm số note đang sống mang nó */
export interface TagCount {
  name: string;
  count: number;
}
```

Quy ước kiểu:
- `Note.createdAt/updatedAt/deletedAt` luôn **ISO string** sau mapper (pg trả `Date` → `toISOString()`, sqlite trả TEXT giữ nguyên) — y hệt `User.createdAt`.
- `Note.shareToken` gồm cả trường hợp **`null`** (chưa bật share) — KHÔNG dùng optional bỏ trống.
- `total`/`count` luôn là `number` kể cả khi driver trả `string` (pg: `COUNT(*)` là int8 → node-pg trả string; mapper phải `Number(...)`, xem §4).

---

## 3. DDL — bảng notes / tags / note_tags (2 driver)

### 3.1. Bảng & khoá — dùng chung cả 2 driver (chỉ khác kiểu timestamp)

| Cột | Kiểu PG | Kiểu SQLite | Ghi chú |
|---|---|---|---|
| `id` | TEXT PK | TEXT PK | `randomUUID()` |
| `owner_id` | TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE | như PG | FK → users |
| `title` | TEXT NOT NULL | như PG | |
| `content` | TEXT NOT NULL DEFAULT '' | như PG | markdown thô |
| `status` | TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')) | như PG | |
| `deleted_at` | TIMESTAMPTZ NULL | TEXT NULL | soft-delete |
| `share_token` | TEXT NULL **UNIQUE** | như PG | nhiều NULL hợp lệ |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | TEXT NOT NULL | |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | TEXT NOT NULL | |

`tags`: `id TEXT PK`, `owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`,
`name TEXT NOT NULL`, ràng buộc bảng **`UNIQUE (owner_id, name)`** (tạo index ngầm → dùng được
`ON CONFLICT DO NOTHING`).

`note_tags` (bảng quan hệ): `note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE`,
`tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE`, **PK kép `(note_id, tag_id)`**.

Index notes (cả 2 driver): `(owner_id)`, `(owner_id, updated_at DESC)`, `(owner_id, deleted_at)`.
Thứ tự DDL bắt buộc: **users → notes → tags → note_tags → index** (vì FK trỏ về users/notes).

### 3.2. Hằng DDL dùng chung cho SQLite — đặt trong `src/data/note.repository.ts`

```typescript
/** SQLite dùng TEXT cho timestamp; db.exec() chạy nhiều câu lệnh được. */
export const CREATE_NOTES_TABLE = `
  CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published')),
    deleted_at  TEXT,
    share_token TEXT UNIQUE,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )
`;

export const CREATE_TAGS_TABLE = `
  CREATE TABLE IF NOT EXISTS tags (
    id       TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    UNIQUE (owner_id, name)
  )
`;

export const CREATE_NOTE_TAGS_TABLE = `
  CREATE TABLE IF NOT EXISTS note_tags (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
  )
`;

export const CREATE_NOTE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_notes_owner_id      ON notes (owner_id);
  CREATE INDEX IF NOT EXISTS idx_notes_owner_updated ON notes (owner_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notes_owner_deleted ON notes (owner_id, deleted_at);
`;
```

### 3.3. Driver SQLite — `src/data/note.sqlite.repository.ts`

Constructor nhận `DatabaseSync` **dùng chung** với `SqliteUserRepository`. `init()` phải:

1. Bật khoá ngoại: `this.db.exec("PRAGMA foreign_keys = ON")` — **bắt buộc** để `note_tags` cascade
   và FK `notes.owner_id → users.id` được kiểm soát (PRAGMA theo từng connection, chạy trước DML);
2. `db.exec` tuần tự: `CREATE_NOTES_TABLE` → `CREATE_TAGS_TABLE` → `CREATE_NOTE_TAGS_TABLE` → `CREATE_NOTE_INDEXES`;
3. Chuẩn bị (prepare) các câu lệnh dùng lại như `user.sqlite.repository.ts` (insert/select/update…),
   cờ `initialized` chống chạy lại.

```typescript
// Phác thảo khởi tạo (cách triển khai tham khảo — bám pattern user.sqlite.repository.ts)
async init(): Promise<void> {
  if (this.initialized) return;
  this.db.exec("PRAGMA foreign_keys = ON");
  this.db.exec(CREATE_NOTES_TABLE);
  this.db.exec(CREATE_TAGS_TABLE);
  this.db.exec(CREATE_NOTE_TAGS_TABLE);
  this.db.exec(CREATE_NOTE_INDEXES);
  // … this.insertNoteStmt = this.db.prepare(...), v.v.
  this.initialized = true;
}
```

### 3.4. Driver PostgreSQL — `src/data/note.pg.repository.ts`

Constructor nhận `Pool` **dùng chung** với `PgUserRepository`. `init()` chạy DDL với
`TIMESTAMPTZ NOT NULL DEFAULT now()` (không dùng hằng SQLite), cùng thứ tự users → notes → tags →
note_tags → index:

```typescript
async init(): Promise<void> {
  await this.pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      content     TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published')),
      deleted_at  TIMESTAMPTZ,
      share_token TEXT UNIQUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tags (
      id       TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name     TEXT NOT NULL,
      UNIQUE (owner_id, name)
    );
    CREATE TABLE IF NOT EXISTS note_tags (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_notes_owner_id      ON notes (owner_id);
    CREATE INDEX IF NOT EXISTS idx_notes_owner_updated ON notes (owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notes_owner_deleted ON notes (owner_id, deleted_at);
  `);
}
```

> Chú thích truy vấn mềm: các câu lệnh tham số hoá (params) — sqlite dùng `?`, pg dùng `$n`.
> Với `list()` (lọc động) driver dựng mảng `WHERE`-parts + mảng params:
> - base: `owner_id = ? AND deleted_at IS NULL`;
> - q: `(LOWER(title) LIKE LOWER(?) OR LOWER(content) LIKE LOWER(?))` với param `"%q%"` (2 lần) —
>   viết `LOWER(...) LIKE LOWER(?)` cho hành vi đồng nhất 2 driver (PG không cần ILIKE);
> - status: `status = ?`;
> - tag: `EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
>   WHERE nt.note_id = notes.id AND t.name = ? AND t.owner_id = ?)` — chặn tag cùng tên của user khác;
> - sắp: `ORDER BY updated_at DESC`, phân trang `LIMIT ? OFFSET (page - 1) * limit`;
> - `total` = `SELECT COUNT(*)` với **cùng** bộ WHERE (không ORDER/LIMIT) → `Number()` hoá.

---

## 4. Mapping / chuyển đổi (mapper) — đặt trong `src/data/note.repository.ts`

Tương đương `mapUserRow` cho note/tag: dòng DB snake_case → kiểu camelCase + chuẩn hoá timestamp.

```typescript
/** Chuẩn hoá timestamp: pg trả Date → ISO string; sqlite trả TEXT → giữ nguyên */
function normalizeTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Map dòng notes (snake_case) → Note (camelCase); NULL cột giữ nguyên là null */
export function mapNoteRow(row: NoteRow): Note {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    content: row.content,
    status: row.status as NoteStatus,
    deletedAt: row.deleted_at ? normalizeTimestamp(row.deleted_at) : null,
    shareToken: row.share_token ?? null,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

/** Map dòng { name } (JOIN note_tags→tags) → tên tag */
export function mapTagNameRow(row: TagNameRow): string {
  return row.name;
}

/** Map dòng { name, count } → TagCount; ép count sang number (pg COUNT(*) trả string int8) */
export function mapTagCountRow(row: { name: string; count: number | string }): TagCount {
  return { name: row.name, count: Number(row.count) };
}
```

Quy tắc mapper:
- `deleted_at` / `share_token` là cột nullable → **giữ `null`** khi DB trả NULL (không biến thành chuỗi rỗng).
- Mọi số đếm (`total`, `count`) phải qua `Number(...)` — pg trả `COUNT(*)` dạng string.
- 2 driver dùng CHUNG mapper này (giống `mapUserRow` hiện tại).

---

## 5. Yêu cầu factory — sửa `src/data/index.ts`

Giữ nguyên tính **lazy** và **dùng chung driver** hiện có: `getNoteRepository()` KHÔNG mở connection
mới mà tái sử dụng `pgPool` / `sqliteDb` do `getUserRepository()` đã tạo (bắt buộc gọi `getUserRepository()`
trước để driver tồn tại). Bổ sung:

```typescript
let noteRepository: NoteRepository | undefined;

/** Tạo (1 lần) note repository theo driver đã chọn — DÙNG CHUNG pool/DatabaseSync với user repository */
export async function getNoteRepository(): Promise<NoteRepository> {
  if (!noteRepository) {
    await getUserRepository(); // đảm bảo pgPool/sqliteDb đã được mở
    if (env.DB_DRIVER === "postgres") {
      const { PgNoteRepository } = await import("./note.pg.repository");
      noteRepository = new PgNoteRepository(pgPool!);
    } else {
      const { SqliteNoteRepository } = await import("./note.sqlite.repository");
      noteRepository = new SqliteNoteRepository(sqliteDb!);
    }
  }
  return noteRepository;
}
```

`initDatabase()` — giữ chữ ký `Promise<void>` + cờ `initPromise`, nhưng nội dung tạo **đủ cả 2 bộ bảng
theo thứ tự FK** (users TRƯỚC rồi mới notes/tags/note_tags — DDL notes có FK trỏ users nên không được chạy song song):

```typescript
export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const userRepo = await getUserRepository();
      await userRepo.init();                       // 1) users
      const noteRepo = await getNoteRepository();
      await noteRepo.init();                       // 2) notes, tags, note_tags, index
    })();
  }
  return initPromise;
}
```

`clearAllNotes()` — dọn sạch notes + tags cho test **file-mode** (mỗi suite bắt đầu sạch như
`clearAllUsers`). **Thứ tự xoá theo FK: xoá `notes` trước** (cascade tự xoá `note_tags`) **rồi mới `tags`**
— KHÔNG xoá users:

```typescript
/** Xoá toàn bộ notes + tags (test file-mode); note_tags tự sạch qua ON DELETE CASCADE */
export async function clearAllNotes(): Promise<void> {
  await initDatabase();
  if (env.DB_DRIVER === "postgres") {
    await pgPool!.query("DELETE FROM notes");
    await pgPool!.query("DELETE FROM tags");
  } else {
    sqliteDb!.exec("DELETE FROM notes");
    sqliteDb!.exec("DELETE FROM tags");
  }
}
```

`closeDatabase()` — thêm reset `noteRepository = undefined` (cạnh các reset hiện có) để tái khởi động sạch.
Hệ quả boot: `server.ts`/`seed.ts` gọi `seedDemoAdmin()` → `initDatabase()` → giờ tạo luôn 3 bảng mới trên
PG khi chạy thật (đúng yêu cầu "PG tạo bảng khi chạy server/seed").

---

## 6. Case kiểm thử cho Red Agent (repository-level — KHÔNG qua HTTP)

### 6.1. Điều kiện chạy (môi trường chuẩn hoá)

- File test đề xuất: `tests/note.repository.test.ts` — vitest thuần (`describe`/`it`), **KHÔNG supertest/HTTP**.
- DB: vitest.config.ts đã set `DB_DRIVER=sqlite`, `DB_FILE=":memory:"` → dùng thẳng factory
  `getNoteRepository()`/`initDatabase()` mà không cần set env trong test. Chạy `npm test`; `npm run test:file`
  chỉ để debug (khi đó các suite gọi `clearAllNotes()` giữa chừng để sạch).
- Fixture: tạo 2 owner qua `getUserRepository().create({...})` (user repo có sẵn — bắt buộc vì
  `notes.owner_id` là FK→users): `ownerA`, `ownerB`; giữ id của chúng.
- `beforeEach`: `await clearAllNotes()` (giữ users) — hoặc mỗi test tự tạo owner riêng để độc lập tuyệt đối.
- Trạng thái RED ban đầu: import `getNoteRepository` chưa tồn tại → test fail vì "chức năng chưa có"
  (module missing) — ĐÚNG là fail mong muốn, không sửa để test qua.
- Mẹo xác định: các note tạo trong cùng mili-giây có `updated_at` bằng nhau → khi cần kiểm THỨ TỰ list,
  hãy `await sleep(5)` giữa các lần create/update; các case còn lại chỉ nên khẳng định tập hợp + total.

### 6.2. Bảng case

#### Nhóm A — create / findById / list / lọc
| # | Case | Hành động | Expected |
|---|---|---|---|
| A1 | create trả Note đầy đủ + mặc định | `create({ownerId: A, title: "Họp tuần"})` | trả Note: `id` khớp UUID regex, `ownerId = A`, `title` đúng, `content = ""`, `status = "draft"`, `deletedAt = null`, `shareToken = null`, `createdAt`/`updatedAt` là ISO string |
| A2 | create giữ giá trị tuỳ chọn | `create({ownerId: A, title: "x", content: "# md", status: "published"})` | `content = "# md"`, `status = "published"` |
| A3 | findById đúng owner | `findById(A, noteA1.id)` | trả Note khớp |
| A4 | findById sai owner → null | `findById(B, noteA1.id)` | `null` (không lộ note người khác) |
| A5 | findById id không tồn tại → null | `findById(A, randomUUID())` | `null` |
| A6 | findById note đã soft-delete → null | softDelete xong rồi `findById(A, id)` | `null` |
| A7 | list mặc định chỉ note SỐNG của mình | ownerA có 2 note sống + 1 note đã soft-delete; ownerB có 1 note | `items.length = 2`, `total = 2`; không chứa note của B, không chứa note đã xoá; mỗi item có đủ `content` |
| A8 | list lọc q theo title | note "Họp tuần 1", note "Họp tuần 2", note "Mua sắm"; `q = "Họp"` | chỉ 2 note chứa "Họp" trong title; `q = "họp"` (thường hoá) cũng trả đúng 2 |
| A9 | list lọc q theo content | note có title "Ghi chú" content "danh sách mua sữa"; `q = "sữa"` | note đó xuất hiện (khớp content) |
| A10 | list lọc status | 1 draft + 2 published; `status = "published"` | `total = 2`, chỉ published; `status = "draft"` → `total = 1` |
| A11 | list lọc tag | note1+note2 gắn "work", note3 gắn "ideas"; `tag = "work"` | `total = 2` đúng note1, note2; note3 không xuất hiện |
| A12 | tag cùng tên của user khác không ảnh hưởng | note của A gắn "work"; note của B cũng gắn "work"; `list({ownerId: A, tag: "work"})` | chỉ note của A |
| A13 | pagination | tạo 5 note; `{page: 1, limit: 2}` | `items.length = 2`, `total = 5`; `{page: 3, limit: 2}` → `items.length = 1`, `total = 5`; `{page: 99, limit: 2}` → `items.length = 0`, `total = 5` |
| A14 | list thứ tự updated_at DESC | tạo note1 → sleep 5ms → create note2 → sleep → update note1 | item đầu tiên là note1 (mới update nhất) |

#### Nhóm B — trash (softDelete / listTrash / restore / hardDelete)
| # | Case | Hành động | Expected |
|---|---|---|---|
| B1 | softDelete note sống của owner | `softDelete(A, id)` | trả `true`; `findById(A, id)` → `null`; `list(A)` không còn; `listTrash(A)` có note đó và `deletedAt` ≠ null |
| B2 | softDelete sai owner / không tồn tại | `softDelete(B, noteA.id)`; `softDelete(A, randomUUID())` | trả `false` (cả 2); note của A vẫn sống |
| B3 | softDelete 2 lần (idempotent) | softDelete xong gọi lại `softDelete(A, id)` | lần 2 trả `false` (đã xoá rồi) |
| B4 | listTrash chỉ thấy note xoá của mình | A xoá 2 note; B xoá 1 note | `listTrash(A).length = 2`; không chứa note của B |
| B5 | restore từ thùng rác | softDelete → `restore(A, id)` | trả Note có `deletedAt = null`; `findById(A, id)` thấy lại; `listTrash(A)` không còn; `list(A)` có lại |
| B6 | restore note đang sống / sai owner | `restore(A, noteSống.id)`; `restore(B, noteĐãXoáCủaA.id)` | `null` (cả 2) |
| B7 | hardDelete sau soft-delete | softDelete → `hardDelete(A, id)` | trả `true`; `findById` → `null`; `listTrash(A)` không còn |
| B8 | hardDelete note đang sống thẳng | `hardDelete(A, idSống)` | trả `true`; mọi truy vấn đều không thấy |
| B9 | hardDelete sai owner / không tồn tại | `hardDelete(B, noteA.id)`; `hardDelete(A, randomUUID())` | trả `false`; note A vẫn còn |
| B10 | hardDelete note có tag → cascade link | note gắn 2 tag → hardDelete | không lỗi FK; `findNoteTags(noteId)` → `[]` |

#### Nhóm C — share token
| # | Case | Hành động | Expected |
|---|---|---|---|
| C1 | setShareToken bật share | `setShareToken(A, id, "tok-1")` | trả Note có `shareToken = "tok-1"`, `updatedAt` KHÔNG đổi so với trước khi set |
| C2 | findByShareToken tra được | sau C1, `findByShareToken("tok-1")` | trả note của A (public — không cần biết owner) |
| C3 | setShareToken null thu hồi | `setShareToken(A, id, null)` | trả Note có `shareToken = null`; `findByShareToken("tok-1")` → `null` |
| C4 | setShareToken sai owner / note đã xoá | `setShareToken(B, noteA.id, "tok-2")`; sau softDelete `setShareToken(A, id, "tok-2")` | `null` (cả 2) |
| C5 | findByShareToken note đã soft-delete | set token → softDelete note → `findByShareToken(token)` | `null` |
| C6 | findByShareToken token lạ | `findByShareToken("không-tồn-tại")` | `null` |
| C7 | token của note owner B vẫn tra được (public) | set cho note B → `findByShareToken` | trả note của B (đúng thiết kế public) |

#### Nhóm D — tags (replaceNoteTags / findNoteTags / listTagsWithCount / removeTag)
| # | Case | Hành động | Expected |
|---|---|---|---|
| D1 | replaceNoteTags gắn 2 tag | `replaceNoteTags(A, noteId, ["work", "ideas"])` | không throw; `findNoteTags(noteId)` → `["ideas", "work"]` (sorted ASC) |
| D2 | replaceNoteTags thay thế toàn bộ (không cộng dồn) | gắn ["work","ideas"] → gắn lại ["work"] | `findNoteTags` → `["work"]` (ideas biến mất) |
| D3 | replaceNoteTags names=[] xoá hết tag | sau D1, `replaceNoteTags(A, noteId, [])` | `findNoteTags` → `[]` |
| D4 | replaceNoteTags note không thuộc owner → no-op | `replaceNoteTags(B, noteCủaA.id, ["x"])` | không throw; `findNoteTags(noteCủaA.id)` → `[]` (không gắn, không tạo tag lạ cho A) |
| D5 | replaceNoteTags trùng tên không tạo trùng | `replaceNoteTags(A, id, ["work", "work"])` | `findNoteTags` → `["work"]` (1 phần tử) |
| D6 | replaceNoteTags trên note đã soft-delete → no-op | softDelete → `replaceNoteTags(A, id, ["x"])` | không throw; `findNoteTags(id)` → `[]` |
| D7 | findNoteTags note không tag | note mới tạo chưa gắn | `[]` |
| D8 | listTagsWithCount đếm đúng | A: note1+note2 gắn "work", note3 gắn "ideas"; B: note gắn "work" | `listTagsWithCount(A)` → `[{name:"ideas",count:1},{name:"work",count:2}]` (sorted name, không lẫn tag của B) |
| D9 | listTagsWithCount bỏ qua note soft-delete | note mang "work" bị softDelete | count "work" giảm đúng; tag không còn note sống nào thì KHÔNG xuất hiện trong kết quả |
| D10 | removeTag xoá khỏi mọi note | 2 note của A gắn "work" → `removeTag(A, "work")` | `findNoteTags` cả 2 → `[]`; `listTagsWithCount(A)` không còn "work"; không throw |
| D11 | removeTag idempotent | `removeTag(A, "chưa-tồn-tại")` | không throw (no-op) |
| D12 | removeTag chỉ ảnh hưởng owner của mình | A và B cùng có tag "work" → `removeTag(A, "work")` | tag "work" của B vẫn còn (kiểm qua note B) |

#### Nhóm E — factory / dọn dẹp
| # | Case | Hành động | Expected |
|---|---|---|---|
| E1 | initDatabase tạo đủ bảng, chạy lại vô hại | `initDatabase()` gọi 2 lần; sau đó dùng mọi method A–D | không throw (CREATE IF NOT EXISTS idempotent) |
| E2 | clearAllNotes dọn notes + tags nhưng GIỮ users | tạo data của A và B → `clearAllNotes()` | `list(A)`/`listTrash(A)` rỗng, `listTagsWithCount` rỗng; `getUserRepository().findAll()` vẫn còn A, B |
| E3 | owner xoá user → cascade xoá notes | tạo note cho A → `deleteById(A.id)` (user repo) | không lỗi FK; dữ liệu notes của A biến mất (kiểm qua các truy vấn owner khác) |

> Lưu ý cho Red Agent: toàn bộ expect trên là hành vi repository — nếu một case lộ ra mâu thuẫn với
> `BACKEND-PLAN.md`, DỪNG và quay lại Spec Agent, không tự "sửa test cho qua" (hợp đồng §4 TDD-WORKFLOW).

---

## 7. Gate Phase 1 & danh sách file sẽ tạo/sửa ở Phase sau (ngoài spec này)

Các file SAU ĐÂY sẽ được tạo/sửa bởi Red/Green Agent — spec này CHỈ mô tả, không tạo:

1. `src/data/note.repository.ts` — **tạo mới**: interface `NoteRepository`, type row, mapper, hằng DDL SQLite (§1, §3.2, §4).
2. `src/data/note.sqlite.repository.ts` — **tạo mới**: driver SQLite (`PRAGMA foreign_keys = ON` + DDL chung + câu lệnh chuẩn bị).
3. `src/data/note.pg.repository.ts` — **tạo mới**: driver PostgreSQL (DDL `TIMESTAMPTZ` + câu lệnh `$n`).
4. `src/types/index.ts` — **sửa**: thêm `NoteStatus`, `Note`, `CreateNoteInput`, `NoteListFilters`, `NoteListResult`, `UpdateNoteInput`, `TagCount` (§2).
5. `src/data/index.ts` — **sửa**: `getNoteRepository()`, mở rộng `initDatabase()` (2 bộ bảng theo thứ tự FK), `clearAllNotes()`, reset trong `closeDatabase()` (§5).
6. `tests/note.repository.test.ts` — **tạo mới (Red Agent)**: bảng case §6 chạy trên SQLite `:memory:`, vitest thuần, không HTTP.

Gate định nghĩa "xong Phase 1" (theo TDD-WORKFLOW): `npm run typecheck` xanh · `npm test` (test mới + cũ)
xanh · `npm run test:file` xanh · `npm run build` chạy được · PG smoke: khởi động server/seed → `psql`
thấy 3 bảng `notes`, `tags`, `note_tags` đã được tạo.
