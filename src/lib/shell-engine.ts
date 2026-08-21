import "server-only";

import { posix } from "node:path";

import {
  createBash,
  getUnsupportedShellFeature,
  restoreWorkspace,
  snapshotWorkspace,
  WORKSPACE_ROOT,
  type PersistedNode,
  type ShellHistoryCommand,
} from "@/lib/workspace-fs";
import {
  emptyShellState,
  restoreShellState,
  snapshotShellState,
  type PersistedShellState,
} from "@/lib/shell-state";

export type ShellEngineRequest = {
  command: string;
  cwd: string;
  nodes: PersistedNode[];
  history: ShellHistoryCommand[];
  state: PersistedShellState;
};

export type ShellEngineResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
  nodes: PersistedNode[];
  state: PersistedShellState;
};

function safeCwd(cwd: string) {
  if (typeof cwd !== "string") return WORKSPACE_ROOT;
  const normalized = posix.normalize(cwd);
  return normalized === WORKSPACE_ROOT ||
    normalized.startsWith(`${WORKSPACE_ROOT}/`)
    ? normalized
    : WORKSPACE_ROOT;
}

/**
 * The only application boundary around the interpreter. It receives a
 * complete virtual workspace and versioned interpreter snapshot, then
 * returns the complete next workspace and snapshot. Server Actions own the
 * transaction, locking, quotas, and transcript; the engine owns execution.
 */
export async function executeShellEngine(
  request: ShellEngineRequest,
): Promise<ShellEngineResult> {
  const fs = await restoreWorkspace(request.nodes);
  const bash = createBash(fs, safeCwd(request.cwd), request.history);
  restoreShellState(bash, request.state);
  const unsupportedFeature = getUnsupportedShellFeature(request.command);
  const execution = unsupportedFeature
    ? {
        stdout: "",
        stderr: `bash: ${unsupportedFeature}: not supported in this virtual shell\n`,
        exitCode: 2,
        env: { PWD: safeCwd(request.cwd) },
      }
    : await bash.exec(request.command);

  const cwd = safeCwd(execution.env?.PWD ?? bash.getCwd());
  return {
    stdout: execution.stdout,
    stderr: execution.stderr,
    exitCode: execution.exitCode,
    cwd,
    nodes: await snapshotWorkspace(fs),
    state: unsupportedFeature
      ? snapshotShellState(bash, 2)
      : snapshotShellState(bash, execution.exitCode),
  };
}

export { emptyShellState };
