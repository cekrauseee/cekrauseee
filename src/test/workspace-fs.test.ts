import { describe, expect, it } from "vitest";

import {
  assertWorkspaceQuota,
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
});
