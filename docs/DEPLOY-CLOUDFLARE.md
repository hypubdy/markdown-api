# Deploy Cloudflare Worker bằng GitHub Actions

Workflow `.github/workflows/deploy-cloudflare.yml` tự chạy khi push lên `main` hoặc chạy thủ công trong tab **Actions**.

## GitHub Secret duy nhất

Vào **Repository → Settings → Environments → production → Environment secrets → Add secret** và tạo đúng một secret:

- `ENV_FILE`: dán toàn bộ nội dung file `.env` production, gồm cả `CLOUDFLARE_API_TOKEN` và `CLOUDFLARE_ACCOUNT_ID`.

Ví dụ nội dung secret (thay toàn bộ giá trị mẫu bằng giá trị thật):

```dotenv
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
JWT_SECRET=...
```

Không thêm dấu nháy quanh giá trị và không commit file `.env`. Workflow tạo file tạm trong runner, deploy Worker, upload các application secrets bằng Wrangler rồi xóa file tạm.

Không ghi các giá trị trên vào source code, `wrangler.jsonc`, `.env.example` hoặc commit Git. File `.env` đã được ignore.

## Tạo Cloudflare API Token

Cloudflare Dashboard → **My Profile → API Tokens → Create Token**. Dùng template **Edit Cloudflare Workers**, giới hạn đúng account cần deploy, rồi lưu token vào GitHub Secret `CLOUDFLARE_API_TOKEN`.

## Lưu runtime secrets trên Cloudflare

Workflow truyền các secret runtime cho Wrangler để cập nhật secret của Worker trong lúc deploy. Các secret không được in ra log. Sau lần deploy đầu tiên, có thể kiểm tra bằng:

```bash
npx wrangler secret list
```

Nếu repository dùng environment `production`, hãy tạo secrets trong đúng environment tương ứng thay vì để ở cấp repository.
