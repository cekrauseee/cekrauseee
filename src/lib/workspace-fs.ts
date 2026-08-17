import "server-only";

import { posix } from "node:path";
// The browser-targeted just-bash bundle is still a pure virtual filesystem
// runtime, but avoids optional native sqlite compression modules that cannot be
// placed in Turbopack's server ESM chunks.
import {
  Bash,
  defineCommand,
  InMemoryFs,
  type IFileSystem,
} from "just-bash/browser";
export {
  emptyShellState,
  parseShellState,
  type PersistedShellState,
} from "@/lib/shell-state";

export const WORKSPACE_ROOT = "/workspace";
export const MAX_NODE_COUNT = 2_000;
export const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024;
export const MAX_COMMAND_BYTES = 16 * 1024;
export const MAX_OUTPUT_BYTES = 128 * 1024;

export type PersistedNodeKind = "file" | "directory" | "symlink";

export type PersistedNode = {
  path: string;
  kind: PersistedNodeKind;
  mode: number;
  contentBase64?: string;
  target?: string;
  sizeBytes: number;
};

export type ShellHistoryCommand = {
  command: string;
};

function isWorkspacePath(value: string) {
  return (
    !value.includes("\0") &&
    (value === WORKSPACE_ROOT || value.startsWith(`${WORKSPACE_ROOT}/`))
  );
}

function normalizeWorkspacePath(value: string) {
  const normalized = posix.normalize(value);
  if (
    !normalized.startsWith(`${WORKSPACE_ROOT}/`) &&
    normalized !== WORKSPACE_ROOT
  ) {
    throw new Error("workspace path escapes its root");
  }
  return normalized;
}

function assertNode(node: PersistedNode) {
  const path = normalizeWorkspacePath(node.path);
  if (path !== node.path || !isWorkspacePath(path)) {
    throw new Error("invalid workspace node path");
  }
  if (!Number.isSafeInteger(node.mode) || node.mode < 0 || node.mode > 0o7777) {
    throw new Error("invalid workspace node mode");
  }
  if (!Number.isSafeInteger(node.sizeBytes) || node.sizeBytes < 0) {
    throw new Error("invalid workspace node size");
  }
  if (node.kind === "file") {
    if (typeof node.contentBase64 !== "string") {
      throw new Error("file content is missing");
    }
    const content = Buffer.from(node.contentBase64, "base64");
    if (content.byteLength !== node.sizeBytes) {
      throw new Error("file content size is invalid");
    }
  } else if (node.kind === "symlink") {
    if (typeof node.target !== "string" || node.target.length > 4096) {
      throw new Error("symlink target is invalid");
    }
  } else if (node.kind !== "directory") {
    throw new Error("workspace node kind is invalid");
  }
}

function decodePersistedBytes(contentBase64: string) {
  // Keep this a plain Uint8Array rather than a Node Buffer. Buffer is a
  // Uint8Array subclass, but the browser-targeted just-bash filesystem's
  // content normalization treats it as string-like in some runtimes.
  return Uint8Array.from(Buffer.from(contentBase64, "base64"));
}

export function assertWorkspaceQuota(nodes: PersistedNode[]) {
  if (nodes.length > MAX_NODE_COUNT) {
    throw new Error("workspace entry quota exceeded");
  }
  let bytes = 0;
  const paths = new Set<string>();
  for (const node of nodes) {
    assertNode(node);
    if (paths.has(node.path)) throw new Error("duplicate workspace path");
    paths.add(node.path);
    bytes += node.sizeBytes;
    if (bytes > MAX_WORKSPACE_BYTES) {
      throw new Error("workspace storage quota exceeded");
    }
  }
  if (!paths.has(WORKSPACE_ROOT)) {
    throw new Error("workspace root is missing");
  }
}

export async function restoreWorkspace(nodes: PersistedNode[]) {
  assertWorkspaceQuota(nodes);
  const fs = new InMemoryFs(undefined, {
    maxTotalBytes: MAX_WORKSPACE_BYTES,
  });
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });

  const directories = nodes
    .filter((node) => node.kind === "directory" && node.path !== WORKSPACE_ROOT)
    .sort((left, right) => left.path.length - right.path.length);
  for (const node of directories) {
    await fs.mkdir(node.path, { recursive: true });
    await fs.chmod(node.path, node.mode);
  }

  const files = nodes.filter((node) => node.kind === "file");
  for (const node of files) {
    await fs.writeFile(node.path, decodePersistedBytes(node.contentBase64!));
    await fs.chmod(node.path, node.mode);
  }

  const symlinks = nodes.filter((node) => node.kind === "symlink");
  for (const node of symlinks) {
    await fs.symlink(node.target!, node.path);
  }

  return fs;
}

export async function snapshotWorkspace(
  fs: IFileSystem,
): Promise<PersistedNode[]> {
  // A command may remove the workspace root itself; recreate the boundary so
  // the next invocation always has a valid persisted root and cwd.
  if (!(await fs.exists(WORKSPACE_ROOT))) {
    await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  }
  const paths = fs
    .getAllPaths()
    .filter(
      (path) =>
        path === WORKSPACE_ROOT || path.startsWith(`${WORKSPACE_ROOT}/`),
    )
    .map(normalizeWorkspacePath)
    .sort((left, right) => left.localeCompare(right));

  if (!paths.includes(WORKSPACE_ROOT)) paths.unshift(WORKSPACE_ROOT);
  const nodes: PersistedNode[] = [];
  for (const path of paths) {
    const stat = await fs.lstat(path);
    if (stat.isDirectory) {
      nodes.push({
        path,
        kind: "directory",
        mode: stat.mode,
        sizeBytes: 0,
      });
    } else if (stat.isSymbolicLink) {
      const target = await fs.readlink(path);
      nodes.push({
        path,
        kind: "symlink",
        mode: stat.mode,
        target,
        sizeBytes: Buffer.byteLength(target),
      });
    } else if (stat.isFile) {
      const content = await fs.readFileBuffer(path);
      nodes.push({
        path,
        kind: "file",
        mode: stat.mode,
        contentBase64: Buffer.from(content).toString("base64"),
        sizeBytes: content.byteLength,
      });
    }
  }

  assertWorkspaceQuota(nodes);
  return nodes;
}

function formatHistoryCommand(command: string) {
  const oneLine = command.replaceAll(/\s+/g, " ").trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 157)}...` : oneLine;
}

function unavailableJobControlCommand(name: string) {
  return defineCommand(name, async () => ({
    stdout: "",
    stderr: `bash: ${name}: job control is not supported in this virtual shell\n`,
    exitCode: 2,
  }));
}

function logoutCommand() {
  return defineCommand("logout", async () => ({
    stdout: "",
    stderr: "bash: logout: not login shell\n",
    exitCode: 1,
  }));
}

function createHistoryCommand(history: ShellHistoryCommand[]) {
  return defineCommand("history", async (args) => {
    if (args.length > 1 || (args[0] && !/^\d+$/.test(args[0]))) {
      return {
        stdout: "",
        stderr: "history: usage: history [n]\n",
        exitCode: 2,
      };
    }

    const requested = args[0] ? Number(args[0]) : history.length;
    const entries = history.slice(-requested);
    const firstNumber = history.length - entries.length + 1;
    const stdout = entries
      .map(
        (entry, index) =>
          `${String(firstNumber + index).padStart(5)}  ${formatHistoryCommand(entry.command)}\n`,
      )
      .join("");

    return { stdout, stderr: "", exitCode: 0 };
  });
}

export function containsBackgroundOperator(command: string) {
  let quote: "single" | "double" | null = null;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "single") {
      escaped = true;
      continue;
    }
    if (character === "'" && quote !== "double") {
      quote = quote === "single" ? null : "single";
      continue;
    }
    if (character === '"' && quote !== "single") {
      quote = quote === "double" ? null : "double";
      continue;
    }
    if (quote) continue;

    if (
      character === "#" &&
      (index === 0 || /\s/.test(command[index - 1] ?? ""))
    ) {
      const nextLine = command.indexOf("\n", index);
      if (nextLine === -1) return false;
      index = nextLine;
      continue;
    }
    if (character !== "&") continue;

    const previous = command[index - 1];
    const next = command[index + 1];
    if (
      previous !== "&" &&
      next !== "&" &&
      previous !== ">" &&
      next !== ">" &&
      previous !== "<"
    ) {
      return true;
    }
  }

  return false;
}

const unsupportedJobControlCommands = new Set(["jobs", "kill", "wait"]);

export function getUnsupportedShellFeature(command: string) {
  try {
    // Bash.transform uses just-bash's real lexer/parser, so command names in
    // &&/|| chains, control structures, functions, and substitutions are all
    // visited without treating quoted arguments or comments as commands.
    const parser = new Bash({
      cwd: WORKSPACE_ROOT,
      python: false,
      javascript: false,
      defenseInDepth: { enabled: false },
    });
    const ast = parser.transform(command).ast as unknown;
    const visit = (value: unknown): string | null => {
      if (!value || typeof value !== "object") return null;
      if (Array.isArray(value)) {
        for (const item of value) {
          const result = visit(item);
          if (result) return result;
        }
        return null;
      }
      const node = value as Record<string, unknown>;
      if (node.background === true) return "background jobs";
      if (node.type === "SimpleCommand") {
        const name = literalCommandName(node.name);
        if (name && unsupportedJobControlCommands.has(name)) return name;
      }
      for (const child of Object.values(node)) {
        const result = visit(child);
        if (result) return result;
      }
      return null;
    };
    const unsupported = visit(ast);
    if (unsupported) return unsupported;
    if (containsBackgroundOperator(command)) return "background jobs";
    return null;
  } catch {
    // Let just-bash produce its normal syntax error for malformed input.
    return null;
  }
}

function literalCommandName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const parts = (value as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  let result = "";
  for (const part of parts) {
    if (!part || typeof part !== "object") return null;
    const node = part as { type?: unknown; value?: unknown; parts?: unknown };
    if (
      (node.type === "Literal" ||
        node.type === "SingleQuoted" ||
        node.type === "Escaped") &&
      typeof node.value === "string"
    ) {
      result += node.value;
      continue;
    }
    if (node.type === "DoubleQuoted" && Array.isArray(node.parts)) {
      const nested = literalCommandName({ parts: node.parts });
      if (nested === null) return null;
      result += nested;
      continue;
    }
    return null;
  }
  return result || null;
}

export function createBash(
  fs: IFileSystem,
  cwd: string,
  history: ShellHistoryCommand[] = [],
) {
  if (typeof cwd !== "string") cwd = WORKSPACE_ROOT;
  const safeCwd =
    posix.normalize(cwd) === WORKSPACE_ROOT ||
    posix.normalize(cwd).startsWith(`${WORKSPACE_ROOT}/`)
      ? posix.normalize(cwd)
      : WORKSPACE_ROOT;
  return new Bash({
    fs,
    cwd: safeCwd,
    env: { HOME: WORKSPACE_ROOT, PATH: "/usr/bin:/bin", PWD: safeCwd },
    python: false,
    javascript: false,
    // Network is intentionally omitted: curl/wget are not registered.
    customCommands: [
      createHistoryCommand(history),
      unavailableJobControlCommand("jobs"),
      unavailableJobControlCommand("wait"),
      unavailableJobControlCommand("kill"),
      logoutCommand(),
    ],
    sessionState: true,
    executionLimits: {
      maxExecutionTimeMs: 3_000,
      maxCommandCount: 500,
      maxLoopIterations: 5_000,
      maxCallDepth: 50,
      maxStringLength: MAX_OUTPUT_BYTES,
      maxOutputSize: MAX_OUTPUT_BYTES,
      maxInputBytes: MAX_COMMAND_BYTES,
    },
    defenseInDepth: { enabled: "auto" },
  });
}
