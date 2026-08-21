const workspaceRoot = "/workspace";

function displayPath(cwd: string) {
  if (cwd === workspaceRoot) return "~";

  return cwd.startsWith(`${workspaceRoot}/`)
    ? `~${cwd.slice(workspaceRoot.length)}`
    : "~";
}

export function PromptPrefix({ cwd }: { cwd: string }) {
  const path = displayPath(cwd);

  return (
    <span className="prompt" aria-label={`Current directory: ${path}`}>
      <span aria-hidden="true">{path}</span>
    </span>
  );
}
