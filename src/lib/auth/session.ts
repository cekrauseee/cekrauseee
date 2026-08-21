import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions, users, workspaces } from "@/lib/db/schema";

export const SESSION_COOKIE = "__Host-shell_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type SessionClaims = JWTPayload & { sub: string; jti: string };

export type AuthenticatedSession = {
  sessionId: string;
  userId: string;
  workspaceId: string;
};

function getSecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  return new TextEncoder().encode(value);
}

function hashJti(jti: string) {
  return createHash("sha256").update(jti).digest("hex");
}

async function signSession(sessionId: string, jti: string, expiresAt: Date) {
  return new SignJWT({ type: "anonymous-shell" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(sessionId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getSecret());
}

function parseClaims(payload: JWTPayload): SessionClaims | null {
  if (typeof payload.sub !== "string" || typeof payload.jti !== "string") {
    return null;
  }
  return payload as SessionClaims;
}

async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

async function createSession() {
  const db = getDb();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  const workspaceId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id: userId, kind: "anonymous" });
    await tx.insert(sessions).values({
      id: sessionId,
      userId,
      jtiHash: hashJti(jti),
      expiresAt,
    });
    await tx.insert(workspaces).values({
      id: workspaceId,
      userId,
      name: "default",
      cwd: "/workspace",
      revision: 0,
    });
  });

  await setSessionCookie(await signSession(sessionId, jti, expiresAt));
  return { sessionId, userId, workspaceId } satisfies AuthenticatedSession;
}

async function authenticateToken(token: string) {
  const verified = await jwtVerify(token, getSecret(), {
    algorithms: ["HS256"],
    requiredClaims: ["sub", "jti", "exp"],
  });
  const claims = parseClaims(verified.payload);
  if (!claims) return null;

  const db = getDb();
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      workspaceId: workspaces.id,
      expiresAt: sessions.expiresAt,
      jtiHash: sessions.jtiHash,
    })
    .from(sessions)
    .innerJoin(workspaces, eq(workspaces.userId, sessions.userId))
    .where(eq(sessions.id, claims.sub))
    .limit(1);

  const row = rows[0];
  if (
    !row ||
    row.jtiHash !== hashJti(claims.jti) ||
    row.expiresAt.getTime() <= Date.now()
  ) {
    return null;
  }

  // Renew during the final week. The JWT and its hashed JTI are rotated
  // together, so verification always requires both a valid signature and DB row.
  if (row.expiresAt.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000) {
    const nextJti = randomUUID();
    const nextExpiry = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
    await db
      .update(sessions)
      .set({
        jtiHash: hashJti(nextJti),
        expiresAt: nextExpiry,
        lastSeenAt: new Date(),
      })
      .where(eq(sessions.id, row.sessionId));
    await setSessionCookie(
      await signSession(row.sessionId, nextJti, nextExpiry),
    );
  } else {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    workspaceId: row.workspaceId,
  } satisfies AuthenticatedSession;
}

/** Authenticate the durable cookie or provision a fresh anonymous identity. */
export async function requireAnonymousSession(): Promise<AuthenticatedSession> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const session = await authenticateToken(token);
      if (session) return session;
    } catch {
      // Invalid/expired cookies are treated as anonymous and replaced below.
    }
  }

  return createSession();
}
