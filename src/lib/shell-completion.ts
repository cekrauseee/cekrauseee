import { posix } from "node:path";
import { getCommandNames } from "just-bash/browser";

export type CompletionNode = {
  path: string;
  kind: "file" | "directory" | "symlink";
};

export type ShellCompletion = {
  candidates: string[];
  start: number;
  end: number;
};

const workspaceRoot = "/workspace";
const browserUnavailableCommands = new Set(["tar", "yq", "xan", "sqlite3"]);
const shellBuiltins = [
  ".",
  ":",
  "alias",
  "break",
  "builtin",
  "cd",
  "command",
  "compgen",
  "complete",
  "continue",
  "declare",
  "echo",
  "eval",
  "exec",
  "exit",
  "fc",
  "export",
  "false",
  "getopts",
  "hash",
  "help",
  "history",
  "let",
  "local",
  "popd",
  "printf",
  "pushd",
  "pwd",
  "read",
  "readonly",
  "return",
  "set",
  "shift",
  "source",
  "test",
  "true",
  "type",
  "typeset",
  "ulimit",
  "umask",
  "unalias",
  "unset",
];
export const shellCommandNames = [
  ...new Set(
    [...getCommandNames(), ...shellBuiltins].filter(
      (name) => !browserUnavailableCommands.has(name),
    ),
  ),
].sort((left, right) => left.localeCompare(right));

function isWorkspacePath(path: string) {
  return path === workspaceRoot || path.startsWith(`${workspaceRoot}/`);
}

function unescapeShellWord(value: string) {
  return value.replace(/\\(.)/g, "$1");
}

function escapeShellWord(value: string) {
  return value.replace(/([\\\s"'`$&;|()<>*?\[\]{}!])/g, "\\$1");
}

function completionTarget(input: string, cursor: number) {
  const beforeCursor = input.slice(0, cursor);
  const match = beforeCursor.match(/(?:^|[\s|&;()])([^\s|&;()]*)$/);
  if (!match) return null;

  const word = match[1];
  const start = cursor - word.length;
  const beforeWord = input.slice(0, start).trimEnd();

  return {
    word,
    start,
    end: cursor,
    isCommand: beforeWord.length === 0 || /(?:^|[|;&])\s*$/.test(beforeWord),
  };
}

function pathCandidates(word: string, cwd: string, nodes: CompletionNode[]) {
  const slashIndex = word.lastIndexOf("/");
  const displayDirectory =
    slashIndex === -1 ? "" : word.slice(0, slashIndex + 1);
  const typedName = unescapeShellWord(
    slashIndex === -1 ? word : word.slice(slashIndex + 1),
  );
  const directoryToken = unescapeShellWord(displayDirectory);
  const directoryPath = directoryToken.startsWith("~/")
    ? posix.normalize(`${workspaceRoot}/${directoryToken.slice(2)}`)
    : directoryToken.startsWith("/")
      ? posix.normalize(directoryToken)
      : posix.resolve(cwd, directoryToken || ".");

  if (!isWorkspacePath(directoryPath)) return [];

  return nodes
    .filter((node) => posix.dirname(node.path) === directoryPath)
    .map((node) => ({
      name: posix.basename(node.path),
      isDirectory: node.kind === "directory",
    }))
    .filter(
      (node) =>
        node.name.startsWith(typedName) &&
        (typedName.startsWith(".") || !node.name.startsWith(".")),
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(
      (node) =>
        `${displayDirectory}${escapeShellWord(node.name)}${
          node.isDirectory ? "/" : ""
        }`,
    );
}

export function getShellCompletion(
  input: string,
  cursor: number,
  cwd: string,
  nodes: CompletionNode[],
): ShellCompletion {
  const target = completionTarget(input, cursor);
  if (!target) return { candidates: [], start: cursor, end: cursor };

  const candidates =
    target.isCommand &&
    !target.word.startsWith(".") &&
    !target.word.startsWith("/") &&
    !target.word.startsWith("~/")
      ? shellCommandNames.filter((name) => name.startsWith(target.word))
      : pathCandidates(target.word, cwd, nodes);

  return { candidates, start: target.start, end: target.end };
}
