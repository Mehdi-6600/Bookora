import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

const secret = new TextEncoder().encode(env.JWT_SECRET);

const ISSUER = "bookora";
const AUDIENCE = "bookora-app";

export type SessionPayload = {
  userId: string;
  telegramId: string;
  isAdmin: boolean;
};

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    userId: payload.userId,
    telegramId: payload.telegramId,
    isAdmin: payload.isAdmin,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const userId = payload.userId;
    const telegramId = payload.telegramId;
    const isAdmin = payload.isAdmin;

    if (typeof userId !== "string" || userId.length === 0) return null;
    if (typeof telegramId !== "string" || telegramId.length === 0) return null;

    return {
      userId,
      telegramId,
      isAdmin: isAdmin === true,
    };
  } catch {
    return null;
  }
}
