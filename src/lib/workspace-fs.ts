import "server-only";

import { posix } from "node:path";
// The browser-targeted just-bash bundle is still a pure virtual filesystem
// runtime, but avoids optional native sqlite compression modules that cannot be
// placed in Turbopack's server ESM chunks.
import { Bash, InMemoryFs, type IFileSystem } from "just-bash/browser";

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

function isWorkspacePath(value: string) {
  return (
    value === WORKSPACE_ROOT ||
    value.startsWith(`${WORKSPACE_ROOT}/`) ||
    !value.includes("\0")
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

export function createBash(fs: IFileSystem, cwd: string) {
  const safeCwd =
    cwd === WORKSPACE_ROOT || cwd.startsWith(`${WORKSPACE_ROOT}/`)
      ? cwd
      : WORKSPACE_ROOT;
  return new Bash({
    fs,
    cwd: safeCwd,
    env: { HOME: WORKSPACE_ROOT, PATH: "/usr/bin:/bin", PWD: safeCwd },
    python: false,
    javascript: false,
    // Network is intentionally omitted: curl/wget are not registered.
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
