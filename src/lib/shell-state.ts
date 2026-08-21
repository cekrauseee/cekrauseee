import "server-only";

import { posix } from "node:path";
import type { Bash, BashStateSnapshot } from "just-bash/browser";

export const SHELL_STATE_VERSION = 1 as const;
export const SHELL_ENGINE_VERSION = "just-bash@3.3.0" as const;
export const MAX_SHELL_STATE_BYTES = 256 * 1024;
export const MAX_SHELL_STATE_ENTRIES = 2_000;
export const MAX_SHELL_HISTORY_ENTRIES = 1_000;
export const MAX_SHELL_HISTORY_COMMAND_LENGTH = 16 * 1024;
export const SHELL_UNSUPPORTED_FEATURES = [
  "process-substitutions",
  "signals",
  "async-job-control",
] as const;
export const SHELL_WORKSPACE_ROOT = "/workspace";

export type PersistedShellState = {
  version: typeof SHELL_STATE_VERSION;
  engineVersion: typeof SHELL_ENGINE_VERSION;
  unsupportedFeatures: readonly string[];
  snapshot: BashStateSnapshot | null;
};

export const emptyShellState: PersistedShellState = {
  version: SHELL_STATE_VERSION,
  engineVersion: SHELL_ENGINE_VERSION,
  unsupportedFeatures: SHELL_UNSUPPORTED_FEATURES,
  snapshot: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const shellOptionKeys = [
  "errexit",
  "pipefail",
  "nounset",
  "xtrace",
  "verbose",
  "posix",
  "allexport",
  "noclobber",
  "noglob",
  "noexec",
  "vi",
  "emacs",
] as const;
const shoptKeys = [
  "extglob",
  "dotglob",
  "nullglob",
  "failglob",
  "globstar",
  "globskipdots",
  "nocaseglob",
  "nocasematch",
  "expand_aliases",
  "lastpipe",
  "xpg_echo",
] as const;

function exactBooleanRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, boolean> {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
    return false;
  return keys.every((key) => typeof value[key] === "boolean");
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function safeInteger(
  value: unknown,
  min = Number.MIN_SAFE_INTEGER,
): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= min
  );
}

function numberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => safeInteger(item, 0));
}

const ulimitKeys = new Set([
  "c",
  "d",
  "f",
  "l",
  "m",
  "n",
  "p",
  "s",
  "t",
  "u",
  "v",
  "x",
]);

function completionRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const allowed = new Set([
    "wordlist",
    "function",
    "command",
    "options",
    "actions",
    "isDefault",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  for (const key of ["wordlist", "function", "command"]) {
    if (key in value && typeof value[key] !== "string") return false;
  }
  for (const key of ["options", "actions"]) {
    if (key in value && !stringArray(value[key])) return false;
  }
  return !("isDefault" in value) || typeof value.isDefault === "boolean";
}

function hasUnsafeKey(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value))
    return value.some((item) => hasUnsafeKey(item, seen));
  return Object.entries(value).some(
    ([key, item]) =>
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype" ||
      hasUnsafeKey(item, seen),
  );
}

function countEntries(value: unknown): number {
  if (value === null || typeof value !== "object") return 1;
  if (Array.isArray(value))
    return 1 + value.reduce((sum, item) => sum + countEntries(item), 0);
  return (
    1 + Object.values(value).reduce((sum, item) => sum + countEntries(item), 0)
  );
}

function safeWorkspacePath(value: unknown): string {
  if (typeof value !== "string" || value.includes("\0"))
    return SHELL_WORKSPACE_ROOT;
  const normalized = posix.normalize(value);
  return normalized === SHELL_WORKSPACE_ROOT ||
    normalized.startsWith(`${SHELL_WORKSPACE_ROOT}/`)
    ? normalized
    : SHELL_WORKSPACE_ROOT;
}

function sanitizeSnapshot(snapshot: BashStateSnapshot): BashStateSnapshot {
  const env = snapshot.env.map(([name, value]) => {
    if (name === "PWD" || name === "OLDPWD" || name === "HOME") {
      return [name, safeWorkspacePath(value)] as [string, string];
    }
    return [name, value] as [string, string];
  });
  return {
    ...snapshot,
    cwd: safeWorkspacePath(snapshot.cwd),
    previousDir: safeWorkspacePath(snapshot.previousDir),
    directoryStack: snapshot.directoryStack.map(safeWorkspacePath),
    env,
  };
}

/**
 * Snapshot values cross the interpreter/application boundary.  Even though
 * the codec only accepts JSON-safe values, callers must not be able to retain
 * references into the live interpreter (or vice versa).
 */
function cloneJson<T>(value: T): T {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string")
    throw new Error("shell state is not JSON serializable");
  return JSON.parse(encoded) as T;
}

function sanitizeState(state: PersistedShellState): PersistedShellState {
  return state.snapshot
    ? { ...state, snapshot: sanitizeSnapshot(state.snapshot) }
    : state;
}

function validSnapshot(value: unknown): value is BashStateSnapshot {
  if (!isRecord(value)) return false;
  if (
    value.version !== SHELL_STATE_VERSION ||
    value.engineVersion !== SHELL_ENGINE_VERSION
  )
    return false;
  if (
    ("defaultCompletionSpec" in value &&
      value.defaultCompletionSpec !== undefined &&
      !completionRecord(value.defaultCompletionSpec)) ||
    ("emptyCompletionSpec" in value &&
      value.emptyCompletionSpec !== undefined &&
      !completionRecord(value.emptyCompletionSpec))
  )
    return false;
  const requiredKeys = [
    "env",
    "arrays",
    "cwd",
    "previousDir",
    "lastExitCode",
    "lastArg",
    "currentLine",
    "options",
    "shoptOptions",
    "completionSpecs",
    "directoryStack",
    "functions",
    "readonlyVars",
    "associativeArrays",
    "namerefs",
    "boundNamerefs",
    "invalidNamerefs",
    "integerVars",
    "lowercaseVars",
    "uppercaseVars",
    "exportedVars",
    "declaredVars",
    "startTime",
    "virtualPid",
    "virtualPpid",
    "virtualUid",
    "virtualGid",
    "bashPid",
    "nextVirtualPid",
    "lastBackgroundPid",
    "fileDescriptors",
    "inputFds",
    "fdAliases",
    "closedStandardFds",
    "hashTable",
  ];
  const optionalKeys = [
    "defaultCompletionSpec",
    "emptyCompletionSpec",
    "nextFd",
    "umask",
    "ulimits",
    "history",
  ];
  if (
    Object.keys(value).some(
      (key) =>
        ![
          ...requiredKeys,
          ...optionalKeys,
          "version",
          "engineVersion",
        ].includes(key),
    ) ||
    requiredKeys.some((key) => !(key in value)) ||
    !Array.isArray(value.env) ||
    !Array.isArray(value.arrays) ||
    !Array.isArray(value.functions) ||
    !Array.isArray(value.completionSpecs) ||
    !Array.isArray(value.directoryStack) ||
    !exactBooleanRecord(value.options, shellOptionKeys) ||
    !exactBooleanRecord(value.shoptOptions, shoptKeys) ||
    !stringArray(value.directoryStack) ||
    !stringArray(value.readonlyVars) ||
    !stringArray(value.associativeArrays) ||
    !stringArray(value.namerefs) ||
    !stringArray(value.boundNamerefs) ||
    !stringArray(value.invalidNamerefs) ||
    !stringArray(value.integerVars) ||
    !stringArray(value.lowercaseVars) ||
    !stringArray(value.uppercaseVars) ||
    !stringArray(value.exportedVars) ||
    !stringArray(value.declaredVars) ||
    !numberArray(value.inputFds) ||
    !numberArray(value.closedStandardFds) ||
    !Array.isArray(value.fdAliases) ||
    !safeInteger(value.startTime, 0) ||
    !safeInteger(value.virtualPid, 0) ||
    !safeInteger(value.virtualPpid, 0) ||
    !safeInteger(value.virtualUid, 0) ||
    !safeInteger(value.virtualGid, 0) ||
    !safeInteger(value.bashPid, 0) ||
    !safeInteger(value.nextVirtualPid, 0) ||
    !safeInteger(value.lastBackgroundPid, 0) ||
    typeof value.cwd !== "string" ||
    typeof value.previousDir !== "string" ||
    typeof value.lastArg !== "string" ||
    !Number.isSafeInteger(value.lastExitCode) ||
    !Number.isSafeInteger(value.currentLine) ||
    ("nextFd" in value &&
      value.nextFd !== undefined &&
      !safeInteger(value.nextFd, 10)) ||
    ("umask" in value &&
      value.umask !== undefined &&
      (!safeInteger(value.umask, 0) || value.umask > 0o777)) ||
    ("ulimits" in value &&
      value.ulimits !== undefined &&
      (!Array.isArray(value.ulimits) ||
        new Set(
          value.ulimits
            .filter((entry): entry is unknown[] => Array.isArray(entry))
            .map((entry) => entry[0]),
        ).size !== value.ulimits.length ||
        value.ulimits.some(
          (entry) =>
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            typeof entry[0] !== "string" ||
            !ulimitKeys.has(entry[0]) ||
            (entry[1] !== null && !safeInteger(entry[1], 0)),
        ))) ||
    ("history" in value &&
      value.history !== undefined &&
      (!Array.isArray(value.history) ||
        value.history.length > MAX_SHELL_HISTORY_ENTRIES ||
        value.history.some(
          (item) =>
            typeof item !== "string" ||
            item.length > MAX_SHELL_HISTORY_COMMAND_LENGTH,
        )))
  )
    return false;
  const mapFields = [
    "env",
    "completionSpecs",
    "functions",
    "fileDescriptors",
    "hashTable",
  ];
  for (const field of mapFields) {
    const entries = value[field];
    if (
      !Array.isArray(entries) ||
      entries.some(
        (entry) =>
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          (typeof entry[0] !== "string" && typeof entry[0] !== "number"),
      )
    )
      return false;
  }
  const lastExitCode = value.lastExitCode as number;
  const currentLine = value.currentLine as number;
  if (
    lastExitCode < 0 ||
    lastExitCode > 255 ||
    currentLine < 0 ||
    (value.inputFds as unknown[]).some((fd) => !safeInteger(fd, 0)) ||
    (value.closedStandardFds as unknown[]).some((fd) => !safeInteger(fd, 0)) ||
    (value.fdAliases as unknown[]).some(
      (entry) =>
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        !safeInteger(entry[0], 0) ||
        !numberArray(entry[1]),
    )
  )
    return false;

  const descriptorEntries = value.fileDescriptors as Array<[number, string]>;
  const descriptorKeys = descriptorEntries.map(([fd]) => fd);
  const descriptorSet = new Set(descriptorKeys);
  if (
    new Set(descriptorKeys).size !== descriptorKeys.length ||
    descriptorKeys.some((fd) => fd > 1_000_000) ||
    (value.inputFds as number[]).some((fd) => !descriptorSet.has(fd)) ||
    new Set(value.inputFds as number[]).size !==
      (value.inputFds as number[]).length ||
    new Set(value.closedStandardFds as number[]).size !==
      (value.closedStandardFds as number[]).length ||
    (value.closedStandardFds as number[]).some((fd) => fd > 2)
  )
    return false;
  const aliasEntries = value.fdAliases as Array<[number, number[]]>;
  const aliasByFd = new Map(aliasEntries);
  if (aliasByFd.size !== aliasEntries.length) return false;
  for (const [fd, aliases] of aliasEntries) {
    if (new Set(aliases).size !== aliases.length || !aliases.includes(fd))
      return false;
    if (aliases.some((member) => !descriptorSet.has(member))) return false;
    const expected = [...aliases].sort((a, b) => a - b).join(",");
    for (const member of aliases) {
      const peer = aliasByFd.get(member);
      if (!peer || [...peer].sort((a, b) => a - b).join(",") !== expected)
        return false;
    }
  }
  if (
    value.env.some(
      ([key, item]) => typeof key !== "string" || typeof item !== "string",
    ) ||
    (value.fileDescriptors as Array<[unknown, unknown]>).some(
      ([key, item]) => !safeInteger(key, 0) || typeof item !== "string",
    ) ||
    (value.hashTable as Array<[unknown, unknown]>).some(
      ([key, item]) => typeof key !== "string" || typeof item !== "string",
    ) ||
    value.functions.some(
      ([key, item]) => typeof key !== "string" || !isRecord(item),
    ) ||
    value.completionSpecs.some(
      ([key, item]) => typeof key !== "string" || !completionRecord(item),
    )
  )
    return false;
  if (
    value.arrays.some(
      (entry) =>
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        !isRecord(entry[1]) ||
        (entry[1].kind !== "indexed" && entry[1].kind !== "associative") ||
        !Array.isArray(entry[1].elements) ||
        entry[1].elements.some(
          (element) =>
            !Array.isArray(element) ||
            element.length !== 2 ||
            typeof element[0] !== "string" ||
            typeof element[1] !== "string",
        ),
    )
  )
    return false;
  if (hasUnsafeKey(value) || countEntries(value) > MAX_SHELL_STATE_ENTRIES)
    return false;
  try {
    const encoded = JSON.stringify(value);
    return (
      typeof encoded === "string" &&
      Buffer.byteLength(encoded, "utf8") <= MAX_SHELL_STATE_BYTES
    );
  } catch {
    return false;
  }
}

export function validateShellState(
  value: unknown,
): value is PersistedShellState {
  if (!isRecord(value)) return false;
  if (
    value.version !== SHELL_STATE_VERSION ||
    value.engineVersion !== SHELL_ENGINE_VERSION
  )
    return false;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "version",
          "engineVersion",
          "unsupportedFeatures",
          "snapshot",
        ].includes(key),
    ) ||
    !Array.isArray(value.unsupportedFeatures) ||
    value.unsupportedFeatures.length !== SHELL_UNSUPPORTED_FEATURES.length ||
    new Set(value.unsupportedFeatures).size !==
      SHELL_UNSUPPORTED_FEATURES.length ||
    value.unsupportedFeatures.some(
      (feature) =>
        typeof feature !== "string" ||
        !SHELL_UNSUPPORTED_FEATURES.includes(
          feature as (typeof SHELL_UNSUPPORTED_FEATURES)[number],
        ),
    )
  )
    return false;
  if (value.snapshot !== null && !validSnapshot(value.snapshot)) return false;
  try {
    const encoded = JSON.stringify(value);
    return (
      typeof encoded === "string" &&
      Buffer.byteLength(encoded, "utf8") <= MAX_SHELL_STATE_BYTES
    );
  } catch {
    return false;
  }
}

export function parseShellState(value: string): PersistedShellState {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_SHELL_STATE_BYTES
  )
    return emptyShellState;
  try {
    const parsed: unknown = JSON.parse(value);
    return validateShellState(parsed) ? sanitizeState(parsed) : emptyShellState;
  } catch {
    return emptyShellState;
  }
}

export function snapshotShellState(
  bash: Bash,
  lastExitCode?: number,
): PersistedShellState {
  const source = cloneJson(sanitizeSnapshot(bash.snapshotState()));
  const snapshot =
    lastExitCode === undefined
      ? source
      : {
          ...source,
          lastExitCode,
          env: [
            ...source.env.filter(([name]) => name !== "?"),
            ["?", String(lastExitCode)] as [string, string],
          ],
        };
  const state: PersistedShellState = {
    version: SHELL_STATE_VERSION,
    engineVersion: SHELL_ENGINE_VERSION,
    unsupportedFeatures: SHELL_UNSUPPORTED_FEATURES,
    snapshot,
  };
  if (!validateShellState(state)) throw new Error("shell state quota exceeded");
  return state;
}

export function restoreShellState(bash: Bash, state: PersistedShellState) {
  const baseline = cloneJson(sanitizeSnapshot(bash.snapshotState()));
  if (!validateShellState(state)) {
    return emptyShellState;
  }
  const safeState = cloneJson(sanitizeState(state));
  if (!safeState.snapshot) return safeState;
  try {
    bash.restoreState(safeState.snapshot);
    return cloneJson(safeState);
  } catch {
    // The just-bash fork restores atomically, but reset to a known baseline as
    // a second guard so malformed durable state cannot poison the invocation.
    bash.restoreState(cloneJson(baseline));
    return emptyShellState;
  }
}
