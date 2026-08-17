import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { closeDbForTests, getDb } from "@/lib/db";
import { users, workspaces } from "@/lib/db/schema";
import {
  clearWorkspaceHistory,
  readWorkspace,
  replaceWorkspace,
} from "@/lib/workspaces";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required; integration tests never use DATABASE_URL from a local or production environment",
  );
}
// The production local-pg path reads DATABASE_URL. The explicit integration
// command has already required TEST_DATABASE_URL, so route only that disposable
// value into the production driver without loading .env.local.
process.env.DATABASE_URL = testDatabaseUrl;
delete process.env.VERCEL;

const db = getDb();
const userId = randomUUID();
const workspaceId = randomUUID();

describe("workspace persistence over local PostgreSQL", () => {
  it("commits a transaction and restores a persisted path/state transition", async () => {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id: userId, kind: "anonymous" });
      await tx.insert(workspaces).values({
        id: workspaceId,
        userId,
        name: "integration",
        cwd: "/workspace",
        revision: 0,
      });

      await replaceWorkspace(
        tx,
        workspaceId,
        [
          {
            path: "/workspace",
            kind: "directory",
            mode: 0o755,
            sizeBytes: 0,
          },
          {
            path: "/workspace/hello.txt",
            kind: "file",
            mode: 0o644,
            contentBase64: Buffer.from("hello from postgres\n").toString(
              "base64",
            ),
            sizeBytes: 20,
          },
        ],
        "/workspace/projects",
        1,
        {
          requestId: `integration-${randomUUID()}`,
          command: "mkdir projects && printf hello",
          stdout: "hello",
          stderr: "",
          exitCode: 0,
        },
      );
    });

    const state = await readWorkspace(db, workspaceId);
    expect(state?.workspace).toMatchObject({
      id: workspaceId,
      cwd: "/workspace/projects",
      revision: 1,
    });
    expect(state?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/workspace/hello.txt",
          kind: "file",
          sizeBytes: 20,
        }),
      ]),
    );
    expect(state?.history).toEqual([
      {
        command: "mkdir projects && printf hello",
        stdout: "hello",
        stderr: "",
        exitCode: 0,
        cwd: "/workspace/projects",
      },
    ]);

    await db.transaction((tx) => clearWorkspaceHistory(tx, workspaceId));

    const clearedState = await readWorkspace(db, workspaceId);
    expect(clearedState?.workspace).toMatchObject({
      cwd: "/workspace/projects",
      revision: 1,
    });
    expect(clearedState?.nodes).toEqual(state?.nodes);
    expect(clearedState?.history).toEqual([]);
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await closeDbForTests();
  });
});
