// @vitest-environment node

import { describe, expect, it } from "vitest";

import { executeShellEngine } from "@/lib/shell-engine";
import {
  emptyShellState,
  parseShellState,
  restoreShellState,
  SHELL_UNSUPPORTED_FEATURES,
  snapshotShellState,
  validateShellState,
} from "@/lib/shell-state";
import {
  createBash,
  restoreWorkspace,
  WORKSPACE_ROOT,
  type PersistedNode,
} from "@/lib/workspace-fs";

const root: PersistedNode = {
  path: WORKSPACE_ROOT,
  kind: "directory",
  mode: 0o755,
  sizeBytes: 0,
};

describe("persistent synchronous shell engine", () => {
  it("commits variables, attributes, arrays, functions, options, cwd, and status", async () => {
    const first = await executeShellEngine({
      command:
        "export MESSAGE=value; readonly LOCKED=yes; declare -i COUNT=2+3; indexed=(zero one); declare -A assoc; assoc[key]=value; fn(){ printf '<%s>\\n' \\\"$MESSAGE\\\"; }; set -o nounset; shopt -s dotglob; mkdir -p /workspace/projects; cd /workspace/projects; false",
      cwd: WORKSPACE_ROOT,
      nodes: [root],
      history: [],
      state: emptyShellState,
    });

    expect(first.exitCode).toBe(1);
    expect(first.cwd).toBe(`${WORKSPACE_ROOT}/projects`);
    expect(first.state.snapshot?.lastExitCode).toBe(1);
    expect(first.state.unsupportedFeatures).toEqual(SHELL_UNSUPPORTED_FEATURES);

    const second = await executeShellEngine({
      command:
        'printf "%s|%s|%s|%s\\n" "$MESSAGE" "$COUNT" "${indexed[1]}" "${assoc[key]}"; fn; set -o | grep nounset; pwd; printf "status=%s arg=%s\\n" "$?" "$_"',
      cwd: first.cwd,
      nodes: first.nodes,
      history: [],
      state: JSON.parse(JSON.stringify(first.state)),
    });

    expect(second.stdout).toContain("value|5|one|value");
    expect(second.stdout).toContain("nounset         on");
    expect(second.stdout).toContain("/workspace/projects");
    expect(second.stdout).toContain("status=0");
    expect(second.exitCode).toBe(0);
  });

  it("persists aliases, unset/export attributes, directory navigation, and completions", async () => {
    const first = await executeShellEngine({
      command:
        "alias ll='printf alias'; shopt -s expand_aliases; export EXPORTED=one; readonly LOCKED=two; declare -i COUNT=2+3; indexed=(zero one); declare -A assoc; assoc[key]=value; fn(){ printf function; }; complete -W 'one two' cat; mkdir -p /workspace/a /workspace/b; cd /workspace/a; cd -; pushd /workspace/b >/dev/null; popd >/dev/null; unset EXPORTED",
      cwd: WORKSPACE_ROOT,
      nodes: [root],
      history: [],
      state: emptyShellState,
    });
    const second = await executeShellEngine({
      command:
        'll; fn; printf "|%s|%s|%s|%s|%s|%s\\n" "${EXPORTED-unset}" "$LOCKED" "$COUNT" "${indexed[1]}" "${assoc[key]}" "$PWD"; complete -p cat',
      cwd: first.cwd,
      nodes: first.nodes,
      history: [],
      state: JSON.parse(JSON.stringify(first.state)),
    });
    expect(second.stdout).toContain("aliasfunction");
    expect(second.stdout).toContain("|unset|two|5|one|value|/workspace");
    expect(second.stdout).toContain("complete -W 'one two' cat");
  });

  it("resets malformed or oversized state without executing it", async () => {
    expect(parseShellState("not-json")).toEqual(emptyShellState);
    expect(
      parseShellState(
        JSON.stringify({
          ...emptyShellState,
          snapshot: { version: 999, engineVersion: "unknown" },
        }),
      ),
    ).toEqual(emptyShellState);
    expect(
      parseShellState(JSON.stringify({ ...emptyShellState, unexpected: true })),
    ).toEqual(emptyShellState);
    expect(parseShellState("x".repeat(300_000))).toEqual(emptyShellState);
  });

  it("rejects every malformed collection shape without throwing", async () => {
    const result = await executeShellEngine({
      command: "true",
      cwd: WORKSPACE_ROOT,
      nodes: [root],
      history: [],
      state: emptyShellState,
    });
    const collectionFields = [
      "env",
      "arrays",
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
      "inputFds",
      "fileDescriptors",
      "fdAliases",
      "closedStandardFds",
      "hashTable",
    ] as const;
    const restoreTarget = createBash(
      await restoreWorkspace([root]),
      WORKSPACE_ROOT,
    );

    for (const field of collectionFields) {
      const malformed = JSON.parse(JSON.stringify(result.state)) as {
        snapshot: Record<string, unknown>;
      };
      malformed.snapshot[field] = "wrong-shape";
      expect(() => validateShellState(malformed)).not.toThrow();
      expect(validateShellState(malformed)).toBe(false);
      expect(parseShellState(JSON.stringify(malformed))).toEqual(
        emptyShellState,
      );
      expect(() =>
        restoreShellState(
          restoreTarget,
          malformed as unknown as Parameters<typeof restoreShellState>[1],
        ),
      ).not.toThrow();
    }
  });

  it("deep-clones function AST and completion state at both boundaries", async () => {
    const live = createBash(await restoreWorkspace([root]), WORKSPACE_ROOT);
    await live.exec("fn(){ printf live; }; complete -W 'one two' cat");

    const snapshot = snapshotShellState(live);
    const functionNode = snapshot.snapshot!.functions[0][1] as {
      body: {
        body: Array<{
          pipelines: Array<{
            commands: Array<{
              args: Array<{ parts: Array<{ value: string }> }>;
            }>;
          }>;
        }>;
      };
    };
    functionNode.body.body[0].pipelines[0].commands[0].args[0].parts[0].value =
      "corrupt";
    (
      snapshot.snapshot!.completionSpecs[0][1] as { wordlist: string }
    ).wordlist = "corrupt";

    const liveResult = await live.exec("fn; complete -p cat");
    expect(liveResult.stdout).toContain("live");
    expect(liveResult.stdout).toContain("complete -W 'one two' cat");

    const restoreInput = snapshotShellState(live);
    const restored = createBash(await restoreWorkspace([root]), WORKSPACE_ROOT);
    restoreShellState(restored, restoreInput);
    const restoredFunction = restoreInput.snapshot!.functions[0][1] as {
      body: {
        body: Array<{
          pipelines: Array<{
            commands: Array<{
              args: Array<{ parts: Array<{ value: string }> }>;
            }>;
          }>;
        }>;
      };
    };
    restoredFunction.body.body[0].pipelines[0].commands[0].args[0].parts[0].value =
      "corrupt";
    (
      restoreInput.snapshot!.completionSpecs[0][1] as { wordlist: string }
    ).wordlist = "corrupt";

    const restoredResult = await restored.exec("fn; complete -p cat");
    expect(restoredResult.stdout).toContain("live");
    expect(restoredResult.stdout).toContain("complete -W 'one two' cat");
  });

  it("keeps network and host filesystem isolated", async () => {
    const result = await executeShellEngine({
      command: "pwd; curl https://example.com; ls /Users",
      cwd: WORKSPACE_ROOT,
      nodes: [root],
      history: [],
      state: emptyShellState,
    });
    expect(result.stdout).toBe(`${WORKSPACE_ROOT}\n`);
    expect(result.stderr).toContain("curl: command not found");
    expect(result.stderr).toContain("ls: /Users: No such file or directory");
    expect(result.nodes).toEqual([root]);
  });

  it("sanitizes cd outside the workspace and keeps the status contract", async () => {
    const first = await executeShellEngine({
      command: "cd /",
      cwd: WORKSPACE_ROOT,
      nodes: [root],
      history: [],
      state: emptyShellState,
    });
    expect(first.cwd).toBe(WORKSPACE_ROOT);
    expect(first.state.snapshot?.cwd).toBe(WORKSPACE_ROOT);
    expect(first.state.snapshot?.env.find(([name]) => name === "PWD")).toEqual([
      "PWD",
      WORKSPACE_ROOT,
    ]);

    const second = await executeShellEngine({
      command: 'pwd; printf "%s\\n" "$PWD"',
      cwd: first.cwd,
      nodes: first.nodes,
      history: [],
      state: JSON.parse(JSON.stringify(first.state)),
    });
    expect(second.stdout).toBe(`${WORKSPACE_ROOT}\n${WORKSPACE_ROOT}\n`);

    const unsupported = await executeShellEngine({
      command: "true && wait",
      cwd: WORKSPACE_ROOT,
      nodes: [root],
      history: [],
      state: emptyShellState,
    });
    expect(unsupported.exitCode).toBe(2);
    expect(unsupported.state.snapshot?.lastExitCode).toBe(2);
    const afterUnsupported = await executeShellEngine({
      command: 'printf "%s\\n" "$?"',
      cwd: WORKSPACE_ROOT,
      nodes: unsupported.nodes,
      history: [],
      state: JSON.parse(JSON.stringify(unsupported.state)),
    });
    expect(afterUnsupported.stdout).toBe("2\n");
  });

  it("persists descriptor alias groups and shared offsets across requests", async () => {
    const first = await executeShellEngine({
      command: "exec 3>/workspace/f; printf hi >&3",
      cwd: WORKSPACE_ROOT,
      nodes: [root],
      history: [],
      state: emptyShellState,
    });
    expect(first.state.snapshot?.fileDescriptors).toEqual([
      [3, "__file__:/workspace/f"],
    ]);

    const second = await executeShellEngine({
      command: "printf x >&3",
      cwd: WORKSPACE_ROOT,
      nodes: first.nodes,
      history: [],
      state: JSON.parse(JSON.stringify(first.state)),
    });
    expect(second.exitCode).toBe(0);
    const fsAfterWrite = await restoreWorkspace(second.nodes);
    expect(await fsAfterWrite.readFile("/workspace/f")).toBe("hix");

    const aliased = await executeShellEngine({
      command:
        "printf abcdef > /workspace/offsets; exec 3<>/workspace/offsets; eval 'exec 4<&3'; IFS= read -r -n 2 -u 3 part; printf '%s' \"$part\"",
      cwd: WORKSPACE_ROOT,
      nodes: [root],
      history: [],
      state: emptyShellState,
    });
    expect(aliased.stdout).toBe("ab");
    expect(aliased.state.snapshot?.fileDescriptors).toEqual([
      [3, "__rw__:18:/workspace/offsets:2:abcdef"],
      [4, "__rw__:18:/workspace/offsets:2:abcdef"],
    ]);
    expect(aliased.state.snapshot?.fdAliases).toEqual([
      [3, [3, 4]],
      [4, [3, 4]],
    ]);

    const continued = await executeShellEngine({
      command: "IFS= read -r -n 2 -u 4 part; printf '%s' \"$part\"",
      cwd: WORKSPACE_ROOT,
      nodes: aliased.nodes,
      history: [],
      state: JSON.parse(JSON.stringify(aliased.state)),
    });
    expect(continued.stdout).toBe("cd");
    expect(continued.state.snapshot?.fileDescriptors).toEqual([
      [3, "__rw__:18:/workspace/offsets:4:abcdef"],
      [4, "__rw__:18:/workspace/offsets:4:abcdef"],
    ]);
  });

  it("rejects malformed descriptor shapes and recovers with a clean state", async () => {
    const first = await executeShellEngine({
      command: "exec 3>/workspace/f; printf hi >&3",
      cwd: WORKSPACE_ROOT,
      nodes: [root],
      history: [],
      state: emptyShellState,
    });

    const malformed = JSON.parse(JSON.stringify(first.state));
    malformed.snapshot.fdAliases = [["bad", []]];
    const recovered = await executeShellEngine({
      command: "printf recovered",
      cwd: WORKSPACE_ROOT,
      nodes: first.nodes,
      history: [],
      state: malformed,
    });
    expect(recovered.stdout).toBe("recovered");
    expect(recovered.exitCode).toBe(0);
    expect(recovered.state.snapshot?.fileDescriptors).toEqual([]);
  });

  it("preserves input descriptors, closed standard descriptors, and allocation state", async () => {
    const result = await executeShellEngine({
      command:
        "exec 5<<<'abcdef'; eval 'exec 0<&-'; exec {fd}>/workspace/allocated; printf '%s' \"$fd\"",
      cwd: WORKSPACE_ROOT,
      nodes: [root],
      history: [],
      state: emptyShellState,
    });
    expect(result.exitCode).toBe(0);
    expect(result.state.snapshot?.fileDescriptors).toEqual([
      [5, "abcdef\n"],
      [10, "__file__:/workspace/allocated"],
    ]);
    expect(result.state.snapshot?.inputFds).toEqual([5]);
    expect(result.state.snapshot?.closedStandardFds).toEqual([0]);
    expect(result.state.snapshot?.nextFd).toBe(11);
  });
});
