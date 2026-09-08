/**
 * Lỗi nghiệp vụ có chủ đích (operational error).
 * Ném ApiError trong action -> error-handler middleware bắt và trả HTTP status tương ứng.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = "Chưa xác thực") {
    return new ApiError(401, message);
  }

  static forbidden(message = "Không có quyền truy cập") {
    return new ApiError(403, message);
  }

  static notFound(message = "Không tìm thấy tài nguyên") {
    return new ApiError(404, message);
  }

  static conflict(message: string) {
    return new ApiError(409, message);
  }
}
