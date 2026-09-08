import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthUser, User } from "../types/index";

export function signAccessToken(user: User): string {
  const payload: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AuthUser {
  const payload = jwt.verify(token, env.JWT_SECRET) as AuthUser;
  return { id: payload.id, email: payload.email, role: payload.role };
}
