// @vitest-environment node

import { describe, expect, it } from "vitest";

import { shellCommandNames } from "@/lib/shell-completion";
import {
  assertWorkspaceQuota,
  containsBackgroundOperator,
  createBash,
  getUnsupportedShellFeature,
  restoreWorkspace,
  snapshotWorkspace,
  WORKSPACE_ROOT,
  type PersistedNode,
} from "@/lib/workspace-fs";
import { restoreShellState, snapshotShellState } from "@/lib/shell-state";

const root: PersistedNode = {
  path: WORKSPACE_ROOT,
  kind: "directory",
  mode: 0o755,
  sizeBytes: 0,
};

describe("workspace filesystem persistence", () => {
  it("hydrates and snapshots directories, files, and symlinks", async () => {
    const nodes: PersistedNode[] = [
      root,
      {
        path: `${WORKSPACE_ROOT}/notes`,
        kind: "directory",
        mode: 0o750,
        sizeBytes: 0,
      },
      {
        path: `${WORKSPACE_ROOT}/notes/today.txt`,
        kind: "file",
        mode: 0o640,
        contentBase64: Buffer.from("ship it\n").toString("base64"),
        sizeBytes: 8,
      },
      {
        path: `${WORKSPACE_ROOT}/latest`,
        kind: "symlink",
        mode: 0o777,
        target: "notes/today.txt",
        sizeBytes: Buffer.byteLength("notes/today.txt"),
      },
    ];

    const fs = await restoreWorkspace(nodes);
    const snapshot = await snapshotWorkspace(fs);

    expect(snapshot.map((node) => [node.path, node.kind])).toEqual([
      [WORKSPACE_ROOT, "directory"],
      [`${WORKSPACE_ROOT}/latest`, "symlink"],
      [`${WORKSPACE_ROOT}/notes`, "directory"],
      [`${WORKSPACE_ROOT}/notes/today.txt`, "file"],
    ]);
    expect(snapshot.find((node) => node.kind === "file")).toMatchObject({
      path: `${WORKSPACE_ROOT}/notes/today.txt`,
      contentBase64: Buffer.from("ship it\n").toString("base64"),
      sizeBytes: 8,
    });
    expect(snapshot.find((node) => node.kind === "symlink")).toMatchObject({
      target: "notes/today.txt",
    });
  });

  it("rejects paths and payloads outside the persistence contract", () => {
    expect(() =>
      assertWorkspaceQuota([
        root,
        {
          path: `${WORKSPACE_ROOT}/../escape`,
          kind: "file",
          mode: 0o644,
          contentBase64: "",
          sizeBytes: 0,
        },
      ]),
    ).toThrow("workspace path escapes its root");

    expect(() =>
      assertWorkspaceQuota([
        root,
        {
          path: `${WORKSPACE_ROOT}/\0`,
          kind: "file",
          mode: 0o644,
          contentBase64: "",
          sizeBytes: 0,
        },
      ]),
    ).toThrow("invalid workspace node path");

    expect(() => assertWorkspaceQuota([root, root])).toThrow(
      "duplicate workspace path",
    );

    expect(() =>
      assertWorkspaceQuota([
        root,
        {
          path: `${WORKSPACE_ROOT}/broken.txt`,
          kind: "file",
          mode: 0o644,
          contentBase64: Buffer.from("different").toString("base64"),
          sizeBytes: 1,
        },
      ]),
    ).toThrow("file content size is invalid");
  });

  it("requires a persisted workspace root", () => {
    expect(() =>
      assertWorkspaceQuota([
        {
          path: `${WORKSPACE_ROOT}/only.txt`,
          kind: "file",
          mode: 0o644,
          contentBase64: "",
          sizeBytes: 0,
        },
      ]),
    ).toThrow("workspace root is missing");
  });

  it("provides persisted history while rejecting unsupported job control", async () => {
    const fs = await restoreWorkspace([root]);
    const bash = createBash(fs, WORKSPACE_ROOT, [
      { command: "pwd" },
      {
        command:
          "printf 'a command that should remain readable in the history output'",
      },
    ]);

    await expect(bash.exec("history 1")).resolves.toMatchObject({
      stdout:
        "    2  printf 'a command that should remain readable in the history output'\n",
      stderr: "",
      exitCode: 0,
    });
    for (const command of ["jobs", "kill"]) {
      await expect(bash.exec(command)).resolves.toMatchObject({
        stdout: "",
        stderr: `bash: ${command}: job control is not supported in this virtual shell\n`,
        exitCode: 2,
      });
    }
    await expect(bash.exec("logout")).resolves.toMatchObject({
      stdout: "",
      stderr: "bash: logout: not login shell\n",
      exitCode: 1,
    });
  });

  it("recognizes only real background operators", () => {
    expect(containsBackgroundOperator("sleep 1 &")).toBe(true);
    expect(containsBackgroundOperator("echo '&' && echo done")).toBe(false);
    expect(containsBackgroundOperator("echo hi # &")).toBe(false);
    expect(containsBackgroundOperator("echo hi # &\nsleep 1 &")).toBe(true);
    expect(containsBackgroundOperator("echo hi &> output.txt")).toBe(false);
    expect(containsBackgroundOperator("cat <&0")).toBe(false);
  });

  it("rejects every unsupported job-control command before execution", () => {
    expect(getUnsupportedShellFeature("wait")).toBe("wait");
    expect(getUnsupportedShellFeature("jobs; echo done")).toBe("jobs");
    expect(getUnsupportedShellFeature("echo wait")).toBeNull();
    expect(getUnsupportedShellFeature("echo '&' && echo done")).toBeNull();
    expect(getUnsupportedShellFeature("sleep 1 &")).toBe("background jobs");
    expect(getUnsupportedShellFeature("true && wait")).toBe("wait");
    expect(getUnsupportedShellFeature("false || jobs")).toBe("jobs");
    expect(getUnsupportedShellFeature("if true; then kill 1; fi")).toBe("kill");
    expect(getUnsupportedShellFeature("cat <(printf hi)")).toBe(
      "process substitutions",
    );
    expect(getUnsupportedShellFeature("cat >(printf hi)")).toBe(
      "process substitutions",
    );
    expect(getUnsupportedShellFeature("cat < <(printf hi)")).toBe(
      "process substitutions",
    );
    expect(getUnsupportedShellFeature("cat <(cat <(printf hi))")).toBe(
      "process substitutions",
    );
    expect(getUnsupportedShellFeature("cat >(cat >(printf hi))")).toBe(
      "process substitutions",
    );
    expect(getUnsupportedShellFeature('echo "$(cat <(printf hi))"')).toBe(
      "process substitutions",
    );
    expect(getUnsupportedShellFeature("fc -l")).toBeNull();
    expect(getUnsupportedShellFeature("umask 077")).toBeNull();
    expect(getUnsupportedShellFeature("ulimit -f")).toBeNull();
    expect(getUnsupportedShellFeature("cat <&0")).toBeNull();
    expect(getUnsupportedShellFeature('echo "$(wait)"')).toBe("wait");
    expect(getUnsupportedShellFeature("echo 'wait jobs'")).toBeNull();
    expect(getUnsupportedShellFeature('echo "<(printf hi)"')).toBeNull();
    expect(getUnsupportedShellFeature("echo '<(printf hi)'")).toBeNull();
    expect(getUnsupportedShellFeature("echo wait # jobs")).toBeNull();
  });

  it("restores synchronous shell state across fresh Bash instances", async () => {
    const fs = await restoreWorkspace([root]);
    const first = createBash(fs, WORKSPACE_ROOT);
    await first.exec(
      "export MESSAGE='persistent value'; set -o nounset; shopt -s dotglob; mkdir -p /workspace/next; pushd /workspace/next >/dev/null",
    );
    const state = snapshotShellState(first);

    const second = createBash(fs, first.getCwd());
    restoreShellState(second, state);
    const secondResult = await second.exec(
      'printf "<%s>\\n" "$MESSAGE"; set -o | grep nounset',
    );

    expect(secondResult).toMatchObject({
      stdout: "<persistent value>\nnounset         on\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("does not advertise a command that resolves as not found", async () => {
    const fs = await restoreWorkspace([root]);
    const bash = createBash(fs, WORKSPACE_ROOT);

    for (const command of shellCommandNames) {
      // These are provided by the session-state fork and are covered by the
      // focused support test below; the audit loop also runs against release
      // tarballs that predate those builtins.
      if (["fc", "ulimit", "umask"].includes(command)) continue;
      const result = await bash.exec(command);
      expect(result.stderr).not.toContain(
        `bash: ${command}: command not found`,
      );
    }
  });

  it("executes fork-provided synchronous builtins", async () => {
    const fs = await restoreWorkspace([root]);
    const bash = createBash(fs, WORKSPACE_ROOT);
    expect((await bash.exec("umask 0077; umask")).stdout).toBe("0077\n");
    expect((await bash.exec("ulimit -f 12; ulimit -f")).stdout).toBe("12\n");
    expect((await bash.exec("fc -l 1 2")).exitCode).toBe(0);
  });
});
