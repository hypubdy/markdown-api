# TDD WORKFLOW + PHÂN CHIA SUBAGENT — Backend Markdown

> Dùng chung với `docs/BACKEND-PLAN.md` (spec) khi bắt đầu triển khai.
> Nguyên tắc: **RED → GREEN → REFACTOR**, mỗi feature đi qua đủ 3 bước,
> được thực thi bởi các **subagent chuyên vai** với hợp đồng (contract) rõ ràng.

---

## 1. Vòng TDD áp dụng cho stack này

**Đỏ (RED)** — viết test trước (đúng hành vi theo spec), chạy thấy FAIL đúng lý do:
- Test data-driven: thêm **case object** vào `tests/*.test.ts` (bảng case ngay trong file)
  + fixture qua `prepare()`; hoặc unit test repository trực tiếp chống interface.
- "Fail đúng lý do" = fail vì chức năng chưa có (404 / chưa có method), KHÔNG fail vì syntax/lỗi test.

**Xanh (GREEN)** — code tối thiểu để test pass, theo đúng kiến trúc module hiện có:
1. `src/data/*.repository.ts` (interface) → driver sqlite + pg → factory trong `src/data/index.ts`.
2. Module `src/modules/<tên>/{schemas,actions,routes}.ts` + mount vào `src/modules/index.ts`.

**Refactor** — giữ test xanh, dọn code: đúng pattern (bảng route object, ApiError, ownership 404),
DRY (mapper/DDL dùng chung), không scope-creep (chỉ theo spec).

**Định nghĩa "xanh" (gate mỗi feature):**
```bash
npm run typecheck
npm test                 # SQLite ":memory:"
npm run test:file        # SQLite file (debug; chỉ khi cần)
npm run build            # esbuild
# + smoke PG khi feature chạm DB: node dist/server.js + curl đúng luồng (docker PG đang bật)
```

---

## 2. Team subagent — vai trò, đầu vào/đầu ra

| # | Vai (agent) | Nhiệm vụ | Đầu vào → Đầu ra | Cấm |
|---|---|---|---|---|
| A | **Spec Agent** | Chuyển 1 user story trong spec thành: case test + fixture + acceptance list | `docs/BACKEND-PLAN.md` → danh sách case (object JSON-like) trong doc `/docs/tdd-slices/<feature>.cases.md` | Sửa code/test |
| B | **Red Agent** | Viết/bổ sung test (bảng case trong file `.test.ts`, fixture `prepare()`); chạy xác nhận FAIL đúng lý do | case spec → `tests/<feature>.test.ts` đang đỏ | Sửa code production |
| C | **Green Agent (Repository)** | Implement interface + 2 driver + factory; DDL đúng mỗi driver | interface + DDL từ spec/Red → `src/data/*` | Sửa test |
| D | **Green Agent (API)** | Implement schemas/actions/routes + mount; ownership/validate đúng spec | routes spec → `src/modules/<tên>/*`, `modules/index.ts` | Sửa test |
| E | **Refactor/Quality Agent** | Review theo pattern chuẩn; chạy typecheck+build+test giữ xanh | toàn bộ code feature → báo cáo + (nếu cần) patch nhỏ | Đổi hành vi/API |
| F | **Integration/DB Agent** | Smoke trên PG Docker (bảng mới qua `psql`), chạy seed, curl end-to-end; kiểm tra cả 2 driver | built app + `.env` PG → báo cáo end-to-end | Sửa logic |

*Ghi chú:* các agent viết code (C, D) làm việc trên **các file khác nhau** nên có thể chạy
song song sau khi Red chốt interface; B luôn trước C/D; E và F là cổng chặn sau cùng.

---

## 3. Pipeline theo Phase (khớp `BACKEND-PLAN.md`)

```
GO ─► [P1 repository]     Spec(A) → Red(B): test repository/API đỏ
      → Green C (interface+sqlite+pg+factory) ─► E Refactor ─► GATE(1): typecheck+tests xanh
      ─► F: PG tạo 3 bảng (psql) ─► Đạt "Phase 1 xong"
      │
      ▼
   [P2 module notes]      Spec(A) → Red(B): thêm case CRUD/trash/share/tags đỏ
      → Green D (schemas/actions/routes + mount) → E Refactor → GATE(2)
      → F: smoke end-to-end trên PG ─► "Phase 2 xong" (curl demo)
      │
      ▼
   [P3 search/pagination] Lặp lại vòng TDD (slice nhỏ: q/status/tag/page/limit + COUNT)
      │
      ▼
   [P4 test hoàn chỉnh]   Red(B) bổ sung case biên (403/404/400/trùng tag/…), chạy file-mode
      │
      ▼
   [P5 seed + README]     Spec(A) xác định dữ liệu demo → Green D thêm seed → E/F chốt
      ─► FINAL GATE: 37 test cũ + test mới đều xanh; PG smoke; README cập nhật
```

Mỗi **slice feature** (vd: "soft-delete + thùng rác", "public share") chạy lại đúng 1 vòng
A→B→C/D→E→F trước khi sang slice kế — tránh gom quá nhiều thay đổi 1 lượt.

---

## 4. Hợp đồng giữa các agent (bắt buộc)

1. Mỗi agent nhận **1 task đơn nhất** + phạm vi file rõ ràng; không sửa file ngoài phạm vi.
2. Agent B (Red) và C/D (Green) **không sửa file của nhau** — nếu test sai thiết kế, quay lại
   Spec Agent (A) sửa spec, không "sửa test cho qua".
3. Mọi agent trả về: **danh sách file đã tạo/sửa + output kiểm chứng** (đỏ/xanh như thế nào).
4. Không bỏ qua gate: trước khi bàn giao phase, phải chạy đủ lệnh ở mục 1.
5. Trạng thái làm việc ghi vào `docs/tdd-status.md` (feature, slice, RED/GREEN/REFACTOR, gate).

---

## 5. Definition of Done (toàn bộ feature markdown)

- [ ] 3 bảng mới (notes, tags, note_tags) chạy được trên cả SQLite (`:memory:`) và PostgreSQL (Docker).
- [ ] API đúng spec: CRUD + trash + tags + public share; chỉ owner (404 cho người khác).
- [ ] Bộ test mới (data-driven) + bộ test cũ: **tất cả xanh** ở cả `npm test` và `npm run test:file`.
- [ ] Smoke PG end-to-end bằng curl (tạo → sửa → share public không token → trash → restore → xoá hẳn).
- [ ] README + seed demo cập nhật; `npm run build`/`start` chạy được.

---

## 6. Cách khởi động

Khi bạn nói **"GO — chạy TDD pipeline"**:
- Bước 1: tôi chạy Phase 1 theo pipeline trên bằng subagent: Spec Agent → Red Agent → Green Agent(s) →
  Refactor Agent → Integration Agent, mỗi lượt thu hồi kết quả và báo cáo trước khi sang bước kế.
- Mỗi slice mới (tags, trash, share...) được xử lý tuần tự như 1 vòng TDD đầy đủ.
- Nếu một agent báo blocker (vd test thiết kế sai, DDL xung đột), dừng pipeline, tôi tổng hợp
  và quay lại Spec Agent sửa spec rồi chạy lại — không "chữa cháy" trong code.
