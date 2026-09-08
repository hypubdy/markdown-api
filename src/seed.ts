import { env } from "./config/env";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  closeDatabase,
  getUserRepository,
  initDatabase,
} from "./data/index";
import { toSafeUser } from "./data/user.repository";

/**
 * SEED DỮ LIỆU DEMO — chạy độc lập (không phải server):
 *   npm run seed            # thêm user demo còn thiếu (không đụng dữ liệu có sẵn)
 *   npm run seed -- --reset # XOÁ hết user rồi seed lại từ đầu (demo sạch)
 *
 * Dùng ĐÚNG driver theo env.DB_DRIVER — .env mặc định là PostgreSQL (docker).
 * Idempotent theo email: chạy lại nhiều lần không tạo trùng.
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

async function main(): Promise<void> {
  await initDatabase();
  const repo = await getUserRepository();

  const reset = process.argv.includes("--reset");
  if (reset) {
    const all = await repo.findAll();
    for (const user of all) {
      await repo.deleteById(user.id);
    }
    console.log(`🗑  Đã xoá ${all.length} user cũ (--reset)`);
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
    const existing = await repo.findByEmail(target.email);
    if (existing) {
      skipped += 1;
      continue;
    }
    await repo.create(target);
    created += 1;
  }

  const users = await repo.findAll();
  console.log(
    `✅ Seed xong (${env.DB_DRIVER}): tạo mới ${created}, đã có ${skipped}, tổng ${users.length} user.`,
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
