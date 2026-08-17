import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";

import { closeDbForTests, getDb } from "@/lib/db";
import {
  transcripts,
  users,
  workspaceNodes,
  workspaces,
} from "@/lib/db/schema";
import { executeInTransaction } from "@/features/shell/transaction";
import {
  clearWorkspaceHistory,
  readWorkspace,
  replaceWorkspace,
} from "@/lib/workspaces";
import {
  emptyShellState,
  MAX_SHELL_STATE_BYTES,
  parseShellState,
  type PersistedShellState,
} from "@/lib/shell-state";

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
const cleanupUserIds = new Set([userId]);

async function createFixture() {
  const fixtureUserId = randomUUID();
  const fixtureWorkspaceId = randomUUID();
  cleanupUserIds.add(fixtureUserId);
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id: fixtureUserId, kind: "anonymous" });
    await tx.insert(workspaces).values({
      id: fixtureWorkspaceId,
      userId: fixtureUserId,
      name: "integration",
      cwd: "/workspace",
      revision: 0,
    });
  });
  return fixtureWorkspaceId;
}

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
        emptyShellState,
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

  it("reloads scalar, export, array, function, option, and cwd state in a fresh engine", async () => {
    const fixtureWorkspaceId = await createFixture();
    const root = { workspaceId: fixtureWorkspaceId };
    await db.insert(workspaceNodes).values({
      workspaceId: root.workspaceId,
      path: "/workspace",
      kind: "directory",
      mode: 0o755,
      sizeBytes: 0,
    });

    const first = await executeInTransaction(
      db,
      root.workspaceId,
      "export PERSISTED_SCALAR=scalar; persisted_array=(zero one); persist_fn(){ printf 'function-ok'; }; set -o noclobber; mkdir project; cd /workspace/project; printf marker > marker.txt",
      `state-a-${randomUUID()}`,
    );
    expect(first).toMatchObject({ revision: 1, cwd: "/workspace/project" });

    const second = await executeInTransaction(
      db,
      root.workspaceId,
      'printf \'%s|%s|%s|%s\\n\' "$PERSISTED_SCALAR" "${persisted_array[1]}" "$(persist_fn)" "$PWD"; set -o | grep \'^noclobber\'',
      `state-b-${randomUUID()}`,
    );
    expect(second).toMatchObject({
      revision: 2,
      cwd: "/workspace/project",
      exitCode: 0,
    });
    if ("stdout" in second) {
      expect(second.stdout).toContain(
        "scalar|one|function-ok|/workspace/project\n",
      );
      expect(second.stdout).toMatch(/noclobber\s+on\n/);
    }

    const persisted = await db
      .select({ shellState: workspaces.shellState, cwd: workspaces.cwd })
      .from(workspaces)
      .where(eq(workspaces.id, root.workspaceId));
    expect(persisted[0]?.cwd).toBe("/workspace/project");
    expect(parseShellState(persisted[0]?.shellState ?? "")).toMatchObject({
      version: 1,
      engineVersion: "just-bash@3.3.0",
      snapshot: expect.objectContaining({ cwd: "/workspace/project" }),
    });
    expect(persisted[0]?.shellState.length).toBeGreaterThan(0);

    const state = await readWorkspace(db, root.workspaceId);
    expect(state?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/workspace/project/marker.txt" }),
      ]),
    );
    expect(state?.history).toHaveLength(2);
    expect(state?.workspace.revision).toBe(2);
  });

  it("reloads descriptor aliases and shared offsets across separate requests", async () => {
    const fixtureWorkspaceId = await createFixture();
    await db.insert(workspaceNodes).values({
      workspaceId: fixtureWorkspaceId,
      path: "/workspace",
      kind: "directory",
      mode: 0o755,
      sizeBytes: 0,
    });

    const first = await executeInTransaction(
      db,
      fixtureWorkspaceId,
      "printf abcdef > /workspace/offsets; exec 3<>/workspace/offsets; eval 'exec 4<&3'; IFS= read -r -n 2 -u 3 part; printf '%s' \"$part\"",
      `descriptor-a-${randomUUID()}`,
    );
    expect(first).toMatchObject({
      revision: 1,
      stdout: "ab",
      exitCode: 0,
    });

    const persisted = await db
      .select({ shellState: workspaces.shellState })
      .from(workspaces)
      .where(eq(workspaces.id, fixtureWorkspaceId));
    const parsed = parseShellState(persisted[0]!.shellState);
    expect(parsed.snapshot?.fileDescriptors).toEqual([
      [3, "__rw__:18:/workspace/offsets:2:abcdef"],
      [4, "__rw__:18:/workspace/offsets:2:abcdef"],
    ]);
    expect(parsed.snapshot?.fdAliases).toEqual([
      [3, [3, 4]],
      [4, [3, 4]],
    ]);

    const second = await executeInTransaction(
      db,
      fixtureWorkspaceId,
      "IFS= read -r -n 2 -u 4 part; printf '%s' \"$part\"",
      `descriptor-b-${randomUUID()}`,
    );
    expect(second).toMatchObject({
      revision: 2,
      stdout: "cd",
      exitCode: 0,
    });
  });

  it("recovers a malformed persisted descriptor snapshot on the next request", async () => {
    const fixtureWorkspaceId = await createFixture();
    await db.insert(workspaceNodes).values({
      workspaceId: fixtureWorkspaceId,
      path: "/workspace",
      kind: "directory",
      mode: 0o755,
      sizeBytes: 0,
    });
    await executeInTransaction(
      db,
      fixtureWorkspaceId,
      "exec 3>/workspace/recovery; printf before >&3",
      `descriptor-recovery-seed-${randomUUID()}`,
    );
    const persisted = await db
      .select({ shellState: workspaces.shellState })
      .from(workspaces)
      .where(eq(workspaces.id, fixtureWorkspaceId));
    const malformed = JSON.parse(persisted[0]!.shellState) as {
      snapshot: Record<string, unknown>;
    };
    malformed.snapshot.fdAliases = [["bad", []]];
    await db
      .update(workspaces)
      .set({ shellState: JSON.stringify(malformed) })
      .where(eq(workspaces.id, fixtureWorkspaceId));

    const recovered = await executeInTransaction(
      db,
      fixtureWorkspaceId,
      "printf recovered",
      `descriptor-recovery-${randomUUID()}`,
    );
    expect(recovered).toMatchObject({
      revision: 2,
      stdout: "recovered",
      exitCode: 0,
    });
    const repaired = await db
      .select({ shellState: workspaces.shellState })
      .from(workspaces)
      .where(eq(workspaces.id, fixtureWorkspaceId));
    expect(parseShellState(repaired[0]!.shellState).snapshot).not.toBeNull();
  });

  it("replays an idempotent request and rejects a request-id command conflict", async () => {
    const fixtureWorkspaceId = await createFixture();
    await db.insert(workspaceNodes).values({
      workspaceId: fixtureWorkspaceId,
      path: "/workspace",
      kind: "directory",
      mode: 0o755,
      sizeBytes: 0,
    });
    const requestId = `replay-${randomUUID()}`;

    const first = await executeInTransaction(
      db,
      fixtureWorkspaceId,
      "printf replay > /workspace/replay.txt",
      requestId,
    );
    const replay = await executeInTransaction(
      db,
      fixtureWorkspaceId,
      "printf replay > /workspace/replay.txt",
      requestId,
    );
    expect(replay).toEqual(first);

    const conflict = await executeInTransaction(
      db,
      fixtureWorkspaceId,
      "printf conflict > /workspace/conflict.txt",
      requestId,
    );
    expect(conflict).toMatchObject({
      conflict: true,
      error: expect.stringContaining("already used"),
    });

    const transcriptRows = await db
      .select()
      .from(transcripts)
      .where(eq(transcripts.workspaceId, fixtureWorkspaceId));
    expect(transcriptRows).toHaveLength(1);
    expect(transcriptRows[0]?.revision).toBe(1);
    expect(
      await db
        .select({ revision: workspaces.revision })
        .from(workspaces)
        .where(eq(workspaces.id, fixtureWorkspaceId)),
    ).toEqual([{ revision: 1 }]);
  });

  it("serializes concurrent distinct requests without losing filesystem or shell state", async () => {
    const fixtureWorkspaceId = await createFixture();
    await db.insert(workspaceNodes).values({
      workspaceId: fixtureWorkspaceId,
      path: "/workspace",
      kind: "directory",
      mode: 0o755,
      sizeBytes: 0,
    });

    const results = await Promise.all([
      executeInTransaction(
        db,
        fixtureWorkspaceId,
        "export FIRST=one; printf one > /workspace/one.txt",
        `concurrent-a-${randomUUID()}`,
      ),
      executeInTransaction(
        db,
        fixtureWorkspaceId,
        "export SECOND=two; printf two > /workspace/two.txt",
        `concurrent-b-${randomUUID()}`,
      ),
    ]);
    expect(
      results
        .map((result) => ("revision" in result ? result.revision : -1))
        .sort(),
    ).toEqual([1, 2]);

    const final = await executeInTransaction(
      db,
      fixtureWorkspaceId,
      'printf \'%s|%s|%s|%s\' "$FIRST" "$SECOND" "$(cat /workspace/one.txt)" "$(cat /workspace/two.txt)"',
      `concurrent-final-${randomUUID()}`,
    );
    expect(final).toMatchObject({
      revision: 3,
      stdout: "one|two|one|two",
      exitCode: 0,
    });

    const transcriptRows = await db
      .select({ command: transcripts.command, revision: transcripts.revision })
      .from(transcripts)
      .where(eq(transcripts.workspaceId, fixtureWorkspaceId))
      .orderBy(asc(transcripts.revision));
    expect(transcriptRows).toHaveLength(3);
    expect(transcriptRows.map((row) => row.revision)).toEqual([1, 2, 3]);
    const nodes = await db
      .select({ path: workspaceNodes.path })
      .from(workspaceNodes)
      .where(eq(workspaceNodes.workspaceId, fixtureWorkspaceId));
    expect(nodes.map((node) => node.path)).toEqual(
      expect.arrayContaining(["/workspace/one.txt", "/workspace/two.txt"]),
    );
  });

  it("recovers from malformed, wrong-shape, and oversized durable state atomically", async () => {
    const fixtureWorkspaceId = await createFixture();
    await db.insert(workspaceNodes).values({
      workspaceId: fixtureWorkspaceId,
      path: "/workspace",
      kind: "directory",
      mode: 0o755,
      sizeBytes: 0,
    });
    const invalidValues = [
      "{",
      '{"version":1,"engineVersion":"just-bash@3.3.0","unsupportedFeatures":[],"snapshot":{"__proto__":{"polluted":true}}}',
      "x".repeat(MAX_SHELL_STATE_BYTES + 1),
    ];

    for (const [index, shellState] of invalidValues.entries()) {
      await db
        .update(workspaces)
        .set({ shellState })
        .where(eq(workspaces.id, fixtureWorkspaceId));
      const result = await executeInTransaction(
        db,
        fixtureWorkspaceId,
        `printf recovered-${index} > /workspace/recovered-${index}.txt`,
        `malformed-${index}-${randomUUID()}`,
      );
      expect(result).toMatchObject({
        revision: index + 1,
        exitCode: 0,
      });
      expect(
        parseShellState(
          (await readWorkspace(db, fixtureWorkspaceId))!.workspace.shellState,
        ),
      ).toMatchObject({
        version: 1,
        engineVersion: "just-bash@3.3.0",
      });
    }

    const beforeFailure = await readWorkspace(db, fixtureWorkspaceId);
    await expect(
      db.transaction((tx) =>
        replaceWorkspace(
          tx,
          fixtureWorkspaceId,
          [],
          "/workspace",
          null as unknown as PersistedShellState,
          99,
          {
            requestId: `rollback-${randomUUID()}`,
            command: "should rollback",
            stdout: "",
            stderr: "",
            exitCode: 0,
          },
        ),
      ),
    ).rejects.toThrow("invalid shell state");
    const afterFailure = await readWorkspace(db, fixtureWorkspaceId);
    expect(afterFailure?.workspace.revision).toBe(
      beforeFailure?.workspace.revision,
    );
    expect(afterFailure?.nodes).toEqual(beforeFailure?.nodes);
    expect(afterFailure?.history).toEqual(beforeFailure?.history);
  });

  afterAll(async () => {
    for (const cleanupUserId of cleanupUserIds) {
      await db.delete(users).where(eq(users.id, cleanupUserId));
    }
    await closeDbForTests();
  });
});
