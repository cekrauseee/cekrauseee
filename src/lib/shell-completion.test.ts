import { describe, expect, it } from "vitest";

import { getShellCompletion } from "@/lib/shell-completion";

const nodes = [
  { path: "/workspace", kind: "directory" as const },
  { path: "/workspace/readme.md", kind: "file" as const },
  { path: "/workspace/report.md", kind: "file" as const },
  { path: "/workspace/projects", kind: "directory" as const },
  { path: "/workspace/projects/release-notes.md", kind: "file" as const },
];

describe("getShellCompletion", () => {
  it("completes commands from the shell command set", () => {
    const completion = getShellCompletion("mk", 2, "/workspace", nodes);

    expect(completion).toMatchObject({ start: 0, end: 2 });
    expect(completion.candidates).toContain("mkdir");
  });

  it("returns files and directories from the current workspace path", () => {
    expect(getShellCompletion("cat re", 6, "/workspace", nodes)).toEqual({
      start: 4,
      end: 6,
      candidates: ["readme.md", "report.md"],
    });
    expect(
      getShellCompletion("cat projects/r", 14, "/workspace", nodes),
    ).toEqual({
      start: 4,
      end: 14,
      candidates: ["projects/release-notes.md"],
    });
  });

  it("does not expose paths outside the workspace", () => {
    expect(getShellCompletion("cat ../", 7, "/workspace", nodes)).toEqual({
      start: 4,
      end: 7,
      candidates: [],
    });
  });
});
