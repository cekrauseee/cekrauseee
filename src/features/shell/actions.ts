"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAnonymousSession } from "@/lib/auth/session";
import { getDb, type Database } from "@/lib/db";
import { transcripts, workspaceNodes, workspaces } from "@/lib/db/schema";
import {
  getUnsupportedShellFeature,
  MAX_COMMAND_BYTES,
  createBash,
  restoreWorkspace,
  snapshotWorkspace,
  WORKSPACE_ROOT,
} from "@/lib/workspace-fs";
import {
  clearWorkspaceHistory,
  ensureWorkspaceRoot,
  readWorkspace,
  replaceWorkspace,
} from "@/lib/workspaces";
import {
  getShellCompletion,
  type ShellCompletion,
} from "@/lib/shell-completion";

const executeInputSchema = z.object({
  command: z.string().min(1).max(MAX_COMMAND_BYTES),
  requestId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9._:-]+$/),
});

const completionInputSchema = z.object({
  input: z.string().max(MAX_COMMAND_BYTES),
  cursor: z.number().int().min(0).max(MAX_COMMAND_BYTES),
});

export type ShellHistoryEntry = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
};

export type InitializeShellResult =
  | {
      ok: true;
      session: {
        cwd: string;
        revision: number;
        history: ShellHistoryEntry[];
      };
    }
  | { ok: false; error: string };

export type ExecuteShellCommandResult =
  | {
      ok: true;
      result: ShellHistoryEntry & {
        cwd: string;
        revision: number;
      };
    }
  | {
      ok: false;
      error: string;
      code?: "conflict" | "validation" | "unavailable";
    };

export type CompleteShellInputResult =
  | { ok: true; completion: ShellCompletion }
  | {
      ok: false;
      error: string;
      code?: "validation" | "unavailable";
    };

export type ClearShellHistoryResult =
  { ok: true } | { ok: false; error: string; code?: "unavailable" };

function unavailable(error = "The shell is temporarily unavailable.") {
  return { ok: false as const, error, code: "unavailable" as const };
}

function safeCwd(cwd: string) {
  return cwd === WORKSPACE_ROOT || cwd.startsWith(`${WORKSPACE_ROOT}/`)
    ? cwd
    : WORKSPACE_ROOT;
}

export async function initializeShell(): Promise<InitializeShellResult> {
  try {
    const session = await requireAnonymousSession();
    const db = getDb();
    await ensureWorkspaceRoot(db, session.workspaceId);
    const state = await readWorkspace(db, session.workspaceId);
    if (!state)
      return { ok: false, error: "The shell workspace was not found." };

    return {
      ok: true,
      session: {
        cwd: safeCwd(state.workspace.cwd),
        revision: state.workspace.revision,
        history: state.history,
      },
    };
  } catch {
    return { ok: false, error: "Unable to initialize the shell right now." };
  }
}

export async function completeShellInput(input: {
  input: string;
  cursor: number;
}): Promise<CompleteShellInputResult> {
  const parsed = completionInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.cursor > parsed.data.input.length) {
    return {
      ok: false,
      error: "Completion input is invalid.",
      code: "validation",
    };
  }

  try {
    const session = await requireAnonymousSession();
    const db = getDb();
    await ensureWorkspaceRoot(db, session.workspaceId);
    const state = await readWorkspace(db, session.workspaceId);
    if (!state) return unavailable("The shell workspace was not found.");

    return {
      ok: true,
      completion: getShellCompletion(
        parsed.data.input,
        parsed.data.cursor,
        safeCwd(state.workspace.cwd),
        state.nodes,
      ),
    };
  } catch {
    return unavailable();
  }
}

export async function clearShellHistory(): Promise<ClearShellHistoryResult> {
  try {
    const session = await requireAnonymousSession();
    const db = getDb();
    const cleared = await db.transaction(async (tx) => {
      const workspaceRows = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, session.workspaceId))
        .for("update")
        .limit(1);
      if (!workspaceRows[0]) return false;

      await clearWorkspaceHistory(tx, session.workspaceId);
      return true;
    });

    if (!cleared) return unavailable("The shell workspace was not found.");
    return { ok: true };
  } catch {
    return unavailable();
  }
}

type TransactionResult =
  | (ShellHistoryEntry & { cwd: string; revision: number })
  | { conflict: true; error: string }
  | { unavailable: true };

async function executeInTransaction(
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
    const fs = await restoreWorkspace(
      nodeRows.map((node) => ({
        path: node.path,
        kind: node.kind as "file" | "directory" | "symlink",
        mode: node.mode,
        contentBase64: node.content ?? undefined,
        target: node.target ?? undefined,
        sizeBytes: node.sizeBytes,
      })),
    );
    const bash = createBash(fs, safeCwd(workspace.cwd), historyRows);
    const unsupportedFeature = getUnsupportedShellFeature(command);
    const execution = unsupportedFeature
      ? {
          stdout: "",
          stderr: `bash: ${unsupportedFeature}: not supported in this virtual shell\n`,
          exitCode: 2,
          env: { PWD: safeCwd(workspace.cwd) },
        }
      : await bash.exec(command);
    // just-bash restores its host execution state after exec(); the final
    // shell PWD is returned in the serializable environment instead.
    const cwd = safeCwd(execution.env?.PWD ?? bash.getCwd());
    const nodes = await snapshotWorkspace(fs);
    const revision = workspace.revision + 1;

    await replaceWorkspace(tx, workspaceId, nodes, cwd, revision, {
      requestId,
      command,
      stdout: execution.stdout,
      stderr: execution.stderr,
      exitCode: execution.exitCode,
    });

    return {
      command,
      stdout: execution.stdout,
      stderr: execution.stderr,
      exitCode: execution.exitCode,
      cwd,
      revision,
    };
  });
}

export async function executeShellCommand(input: {
  command: string;
  requestId: string;
}): Promise<ExecuteShellCommandResult> {
  const parsed = executeInputSchema.safeParse(input);
  if (
    !parsed.success ||
    !parsed.data.command.trim() ||
    Buffer.byteLength(parsed.data.command, "utf8") > MAX_COMMAND_BYTES
  ) {
    return {
      ok: false,
      error: "Command or request ID is invalid.",
      code: "validation",
    };
  }

  try {
    const session = await requireAnonymousSession();
    const db = getDb();
    await ensureWorkspaceRoot(db, session.workspaceId);
    const result = await executeInTransaction(
      db,
      session.workspaceId,
      parsed.data.command,
      parsed.data.requestId,
    );
    if ("unavailable" in result) return unavailable();
    if ("conflict" in result) {
      return { ok: false, error: result.error, code: "conflict" };
    }
    return { ok: true, result };
  } catch (error) {
    // Quota/parser/database failures should not expose implementation details.
    if (
      error instanceof Error &&
      /quota|workspace (path|node)/i.test(error.message)
    ) {
      return {
        ok: false,
        error: "The workspace storage limit was exceeded.",
        code: "validation",
      };
    }
    return unavailable();
  }
}
