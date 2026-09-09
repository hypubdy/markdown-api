import { spawnSync } from "node:child_process";

/**
 * Đảm bảo console Windows hiển thị đúng tiếng Việt/Unicode (UTF-8).
 *
 * Nguyên nhân "lỗi font" khi seed/log: Node LUÔN ghi stdout bằng UTF-8, nhưng console
 * Windows mặc định dùng codepage 850/1252 → các ký tự "ệ/ả/ắ/ữ" hiện thành "?" (sai).
 * `chcp 65001` chuyển console hiện tại sang UTF-8 để render đúng.
 *
 * - Windows: chạy `chcp 65001` (bỏ qua lỗi nếu console không hỗ trợ).
 * - macOS/Linux: không cần (mặc định đã UTF-8) → no-op.
 */
export function ensureUtf8Console(): void {
  if (process.platform !== "win32") return;
  try {
    spawnSync("cmd", ["/c", "chcp", "65001"], { stdio: "ignore" });
  } catch {
    // console không hỗ trợ chcp → người dùng nên dùng Windows Terminal / VS Code terminal.
  }
}
