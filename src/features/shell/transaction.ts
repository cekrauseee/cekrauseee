import "server-only";

import { posix } from "node:path";
import { and, eq } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { transcripts, workspaceNodes, workspaces } from "@/lib/db/schema";
import { WORKSPACE_ROOT } from "@/lib/workspace-fs";
import { executeShellEngine } from "@/lib/shell-engine";
import { parseShellState } from "@/lib/shell-state";
import { replaceWorkspace } from "@/lib/workspaces";

export type TransactionResult =
  | {
      command: string;
      stdout: string;
      stderr: string;
      exitCode: number;
      cwd: string;
      revision: number;
    }
  | { conflict: true; error: string }
  | { unavailable: true };

function safeCwd(cwd: string) {
  if (typeof cwd !== "string") return WORKSPACE_ROOT;
  const normalized = posix.normalize(cwd);
  return normalized === WORKSPACE_ROOT ||
    normalized.startsWith(`${WORKSPACE_ROOT}/`)
    ? normalized
    : WORKSPACE_ROOT;
}

/**
 * Execute one already-validated command against a workspace transaction.
 * The Server Action supplies authentication and validation; this server-only
 * seam lets integration tests exercise the same lock/idempotency path without
 * fabricating Next's request cookie store.
 */
export async function executeInTransaction(
  db: Database,
  workspaceId: string,
  command: string,
  requestId: string,
): Promise<TransactionResult> {
  return db.transaction(async (tx) => {
    // Serialize commands for one workspace. This also makes the unique
    // requestId transcript row a reliable idempotency boundary.
    const workspaceRows = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update")
      .limit(1);
    const workspace = workspaceRows[0];
    if (!workspace) return { unavailable: true };

    const previousRows = await tx
      .select()
      .from(transcripts)
      .where(
        and(
          eq(transcripts.workspaceId, workspaceId),
          eq(transcripts.requestId, requestId),
        ),
      )
      .limit(1);
    const previous = previousRows[0];
    if (previous) {
      if (previous.command !== command) {
        return {
          conflict: true,
          error: "This request ID was already used for another command.",
        };
      }
      return {
        command: previous.command,
        stdout: previous.stdout,
        stderr: previous.stderr,
        exitCode: previous.exitCode,
        cwd: previous.cwd,
        revision: previous.revision,
      };
    }

    const nodeRows = await tx
      .select()
      .from(workspaceNodes)
      .where(eq(workspaceNodes.workspaceId, workspaceId));
    const historyRows = await tx
      .select({ command: transcripts.command })
      .from(transcripts)
      .where(eq(transcripts.workspaceId, workspaceId))
      .orderBy(transcripts.createdAt, transcripts.id);
    const execution = await executeShellEngine({
      command,
      cwd: safeCwd(workspace.cwd),
      nodes: nodeRows.map((node) => ({
        path: node.path,
        kind: node.kind as "file" | "directory" | "symlink",
        mode: node.mode,
        contentBase64: node.content ?? undefined,
        target: node.target ?? undefined,
        sizeBytes: node.sizeBytes,
      })),
      history: historyRows,
      state: parseShellState(workspace.shellState),
    });
    const revision = workspace.revision + 1;

    await replaceWorkspace(
      tx,
      workspaceId,
      execution.nodes,
      execution.cwd,
      execution.state,
      revision,
      {
        requestId,
        command,
        stdout: execution.stdout,
        stderr: execution.stderr,
        exitCode: execution.exitCode,
      },
    );

    return {
      command,
      stdout: execution.stdout,
      stderr: execution.stderr,
      exitCode: execution.exitCode,
      cwd: execution.cwd,
      revision,
    };
  });
}
