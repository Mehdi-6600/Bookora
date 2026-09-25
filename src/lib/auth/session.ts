import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth/jwt";

export const SESSION_COOKIE = "bookora_session";

export type CurrentUser = {
  id: string;
  telegramId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  isAdmin: boolean;
};

/**
 * کاربر جاری رو از cookie می‌خونه. اگه لاگین نباشه، null برمی‌گردونه.
 * توی Server Components، API routes و Server Actions کار می‌کنه.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySession(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      telegramId: true,
      firstName: true,
      lastName: true,
      telegramUsername: true,
      languageCode: true,
      isAdmin: true,
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    telegramId: user.telegramId,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.telegramUsername,
    languageCode: user.languageCode,
    isAdmin: user.isAdmin,
  };
}

/**
 * مثل getCurrentUser ولی اگه کاربر لاگین نباشه، خطا پرتاب می‌کنه.
 * برای API routes که auth اجباری دارن.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}
