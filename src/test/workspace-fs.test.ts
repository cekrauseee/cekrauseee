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
    for (const command of ["jobs", "kill", "fc"]) {
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
  });

  it("rejects every unsupported job-control command before execution", () => {
    expect(getUnsupportedShellFeature("wait")).toBe("wait");
    expect(getUnsupportedShellFeature("jobs; echo done")).toBe("jobs");
    expect(getUnsupportedShellFeature("echo wait")).toBeNull();
    expect(getUnsupportedShellFeature("echo '&' && echo done")).toBeNull();
    expect(getUnsupportedShellFeature("sleep 1 &")).toBe("background jobs");
  });

  it("does not advertise a command that resolves as not found", async () => {
    const fs = await restoreWorkspace([root]);
    const bash = createBash(fs, WORKSPACE_ROOT);

    for (const command of shellCommandNames) {
      const result = await bash.exec(command);
      expect(result.stderr).not.toContain(
        `bash: ${command}: command not found`,
      );
    }
  });
});
