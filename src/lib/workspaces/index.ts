import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { transcripts, workspaceNodes, workspaces } from "@/lib/db/schema";
import {
  WORKSPACE_ROOT,
  type PersistedShellState,
  type PersistedNode,
  type PersistedNodeKind,
} from "@/lib/workspace-fs";
import { validateShellState } from "@/lib/shell-state";

export const MAX_HISTORY_ENTRIES = 200;

type WorkspaceWriteExecutor = Pick<
  Database,
  "delete" | "insert" | "select" | "update"
>;

export type WorkspaceState = {
  workspace: typeof workspaces.$inferSelect;
  nodes: PersistedNode[];
  history: Array<{
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    cwd: string;
  }>;
};

function toPersistedNode(
  node: typeof workspaceNodes.$inferSelect,
): PersistedNode {
  return {
    path: node.path,
    kind: node.kind as PersistedNodeKind,
    mode: node.mode,
    contentBase64: node.content ?? undefined,
    target: node.target ?? undefined,
    sizeBytes: node.sizeBytes,
  };
}

export async function readWorkspace(
  db: Database,
  workspaceId: string,
): Promise<WorkspaceState | null> {
  const workspaceRows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const workspace = workspaceRows[0];
  if (!workspace) return null;

  const [nodeRows, historyRows] = await Promise.all([
    db
      .select()
      .from(workspaceNodes)
      .where(eq(workspaceNodes.workspaceId, workspaceId))
      .orderBy(asc(workspaceNodes.path)),
    db
      .select()
      .from(transcripts)
      .where(eq(transcripts.workspaceId, workspaceId))
      .orderBy(desc(transcripts.createdAt), desc(transcripts.id))
      .limit(MAX_HISTORY_ENTRIES),
  ]);

  return {
    workspace,
    nodes: nodeRows.map(toPersistedNode),
    history: historyRows.reverse().map((entry) => ({
      command: entry.command,
      stdout: entry.stdout,
      stderr: entry.stderr,
      exitCode: entry.exitCode,
      cwd: entry.cwd,
    })),
  };
}

export async function ensureWorkspaceRoot(db: Database, workspaceId: string) {
  const existing = await db
    .select({ id: workspaceNodes.id })
    .from(workspaceNodes)
    .where(
      and(
        eq(workspaceNodes.workspaceId, workspaceId),
        eq(workspaceNodes.path, WORKSPACE_ROOT),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  // The composite unique key makes this safe when two first actions race.
  await db
    .insert(workspaceNodes)
    .values({
      workspaceId,
      path: WORKSPACE_ROOT,
      kind: "directory",
      mode: 0o755,
      sizeBytes: 0,
    })
    .onConflictDoNothing({
      target: [workspaceNodes.workspaceId, workspaceNodes.path],
    });
}

async function pruneWorkspaceHistory(
  tx: WorkspaceWriteExecutor,
  workspaceId: string,
) {
  const staleRows = await tx
    .select({ id: transcripts.id })
    .from(transcripts)
    .where(eq(transcripts.workspaceId, workspaceId))
    .orderBy(desc(transcripts.createdAt), desc(transcripts.id))
    .offset(MAX_HISTORY_ENTRIES);
  if (staleRows.length === 0) return;

  await tx.delete(transcripts).where(
    and(
      eq(transcripts.workspaceId, workspaceId),
      inArray(
        transcripts.id,
        staleRows.map((row) => row.id),
      ),
    ),
  );
}

export async function clearWorkspaceHistory(
  tx: WorkspaceWriteExecutor,
  workspaceId: string,
) {
  await tx.delete(transcripts).where(eq(transcripts.workspaceId, workspaceId));
}

export async function replaceWorkspace(
  tx: WorkspaceWriteExecutor,
  workspaceId: string,
  nodes: PersistedNode[],
  cwd: string,
  shellState: PersistedShellState,
  revision: number,
  transcript: {
    requestId: string;
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
  },
) {
  if (!validateShellState(shellState)) {
    throw new Error("invalid shell state");
  }
  await tx
    .delete(workspaceNodes)
    .where(eq(workspaceNodes.workspaceId, workspaceId));
  if (nodes.length > 0) {
    await tx.insert(workspaceNodes).values(
      nodes.map((node) => ({
        workspaceId,
        path: node.path,
        kind: node.kind,
        mode: node.mode,
        content: node.contentBase64 ?? null,
        target: node.target ?? null,
        sizeBytes: node.sizeBytes,
      })),
    );
  }
  await tx.insert(transcripts).values({
    workspaceId,
    requestId: transcript.requestId,
    command: transcript.command,
    stdout: transcript.stdout,
    stderr: transcript.stderr,
    exitCode: transcript.exitCode,
    cwd,
    revision,
  });
  // Keep the newest MAX_HISTORY_ENTRIES rows, including the command just
  // committed. This bounds both read cost and durable anonymous storage.
  await pruneWorkspaceHistory(tx, workspaceId);
  await tx
    .update(workspaces)
    .set({
      cwd,
      shellState: JSON.stringify(shellState),
      revision,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));
}
