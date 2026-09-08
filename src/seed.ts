import { env } from "./config/env";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  clearAllNotes,
  closeDatabase,
  getNoteRepository,
  getUserRepository,
  initDatabase,
} from "./data/index";
import { toSafeUser } from "./data/user.repository";

/**
 * SEED DỮ LIỆU DEMO — chạy độc lập (không phải server):
 *   npm run seed            # thêm user demo còn thiếu + notes markdown mẫu (không đụng dữ liệu có sẵn)
 *   npm run seed -- --reset # XOÁ hết notes + tags + users rồi seed lại từ đầu (demo sạch)
 *
 * Dùng ĐÚNG driver theo env.DB_DRIVER — .env mặc định là PostgreSQL (docker).
 * Idempotent: user theo email, notes chỉ seed khi user CHƯA có note nào.
 */

/** Danh sách user demo (mật khẩu mặc định: matkhau123) */
const DEMO_USERS: ReadonlyArray<{
  name: string;
  email: string;
  role?: "admin" | "user";
}> = [
  { name: "Nguyễn Văn An", email: "an.nguyen@example.com" },
  { name: "Trần Thị Bích", email: "bich.tran@example.com" },
  { name: "Lê Minh Cường", email: "cuong.le@example.com" },
  { name: "Phạm Thu Hà", email: "ha.pham@example.com" },
  { name: "Hoàng Đức Huy", email: "huy.hoang@example.com" },
  { name: "Vũ Ngọc Linh", email: "linh.vu@example.com" },
  { name: "Đặng Quốc Minh", email: "minh.dang@example.com", role: "admin" },
  { name: "Bùi Thanh Nam", email: "nam.bui@example.com" },
  { name: "Đỗ Hải Ngân", email: "ngan.do@example.com" },
  { name: "Ngô Phương Oanh", email: "oanh.ngo@example.com" },
  { name: "Cao Văn Phúc", email: "phuc.cao@example.com" },
  { name: "Đinh Thu Quỳnh", email: "quynh.dinh@example.com" },
  { name: "Lý Gia Bảo", email: "bao.ly@example.com" },
  { name: "Mai Khánh Vy", email: "vy.mai@example.com" },
];

/** Notes markdown mẫu seed cho mỗi user (kèm tag "demo") */
const SAMPLE_NOTES: ReadonlyArray<{ title: string; content: string }> = [
  {
    title: "Hướng dẫn Markdown",
    content: `# Hướng dẫn Markdown

Đây là một note demo dùng chung để xem API **notes** hoạt động.

## Cú pháp cơ bản

- **In đậm** và *in nghiêng*
- \`code inline\`
- Danh sách:
  1. Một
  2. Hai

> Trích dẫn cũng được.

\`\`\`
// khối code
const x = 1;
\`\`\`
`,
  },
  {
    title: "Công việc trong tuần",
    content: `# Công việc trong tuần

- [x] Họp dự án thứ 2
- [ ] Viết spec module mới
- [ ] Review code

## Ghi chú

Thử gửi **PATCH /notes/:id** để cập nhật note này.`,
  },
];

async function main(): Promise<void> {
  await initDatabase();
  const usersRepo = await getUserRepository();
  const notesRepo = await getNoteRepository();

  const reset = process.argv.includes("--reset");
  if (reset) {
    await clearAllNotes(); // tránh vi phạm FK khi xoá users (notes.owner_id → users.id)
    const all = await usersRepo.findAll();
    for (const user of all) {
      await usersRepo.deleteById(user.id);
    }
    console.log(`🗑  Đã xoá ${all.length} user cũ + toàn bộ notes/tags (--reset)`);
  }

  const targets = [
    {
      name: "Quản trị viên",
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: "admin" as const,
    },
    ...DEMO_USERS.map((u) => ({
      name: u.name,
      email: u.email,
      password: "matkhau123",
      role: (u.role ?? "user") as "admin" | "user",
    })),
  ];

  let created = 0;
  let skipped = 0;
  for (const target of targets) {
    const existing = await usersRepo.findByEmail(target.email);
    if (existing) {
      skipped += 1;
      continue;
    }
    await usersRepo.create(target);
    created += 1;
  }

  // Seed notes markdown mẫu — chỉ khi user CHƯA có note nào (idempotent)
  let notesSeeded = 0;
  let noteOwnersSkipped = 0;
  for (const target of targets) {
    const user = await usersRepo.findByEmail(target.email);
    if (!user) continue;

    const { total } = await notesRepo.list({ ownerId: user.id, page: 1, limit: 1 });
    if (total > 0) {
      noteOwnersSkipped += 1;
      continue;
    }
    for (const sample of SAMPLE_NOTES) {
      const note = await notesRepo.create({
        ownerId: user.id,
        title: sample.title,
        content: sample.content,
        status: "published",
      });
      await notesRepo.replaceNoteTags(user.id, note.id, ["demo"]);
      notesSeeded += 1;
    }
  }

  const users = await usersRepo.findAll();
  console.log(
    `✅ Seed xong (${env.DB_DRIVER}): tạo mới ${created} user, đã có ${skipped}; ` +
      `notes demo mới ${notesSeeded} (${noteOwnersSkipped} user đã có note).`,
  );
  console.table(users.map((u) => toSafeUser(u)));

  console.log(
    `\n🔑 Mật khẩu mọi user demo: matkhau123 — admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`,
  );
}

try {
  await main();
} catch (error) {
  console.error("❌ Seed thất bại:", error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
