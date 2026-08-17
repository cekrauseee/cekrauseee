import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeShellCommand, initializeShell } from "@/features/shell/actions";
import { TerminalShell } from "@/features/terminal/components/terminal-shell";

vi.mock("@/features/shell/actions", () => ({
  executeShellCommand: vi.fn(),
  initializeShell: vi.fn(),
}));

const mockedInitializeShell = vi.mocked(initializeShell);
const mockedExecuteShellCommand = vi.mocked(executeShellCommand);

function readySession() {
  return {
    ok: true as const,
    session: {
      cwd: "/workspace",
      revision: 3,
      history: [],
    },
  };
}

describe("TerminalShell", () => {
  beforeEach(() => {
    mockedInitializeShell.mockResolvedValue(readySession());
  });

  it("bootstraps a persisted session and renders a successful command", async () => {
    mockedInitializeShell.mockResolvedValueOnce({
      ok: true,
      session: {
        cwd: "/workspace/projects",
        revision: 7,
        history: [
          {
            command: "pwd",
            stdout: "/workspace/projects\n",
            stderr: "",
            exitCode: 0,
          },
        ],
      },
    });
    mockedExecuteShellCommand.mockResolvedValueOnce({
      ok: true,
      result: {
        command: "printf hello",
        stdout: "hello",
        stderr: "",
        exitCode: 0,
        cwd: "/workspace/projects",
        revision: 8,
      },
    });

    render(<TerminalShell />);

    expect(
      await within(screen.getByLabelText("Session details")).findByText(
        "guest@shell:/workspace/projects $",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (content, element) =>
          element?.tagName === "PRE" &&
          content.trim() === "/workspace/projects",
      ),
    ).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "Shell command" });
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "printf hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(screen.getByText("revision 8", { exact: true })).toBeInTheDocument();
    expect(mockedExecuteShellCommand).toHaveBeenCalledWith({
      command: "printf hello",
      requestId: expect.any(String),
    });
  });

  it("renders a server-action command error with its code", async () => {
    mockedExecuteShellCommand.mockResolvedValueOnce({
      ok: false,
      error: "Command rejected",
      code: "validation",
    });

    render(<TerminalShell />);
    const input = screen.getByRole("textbox", { name: "Shell command" });
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "bad command" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Command rejected [validation]",
    );
    expect(
      screen.getByText("Command failed: Command rejected [validation]"),
    ).toBeInTheDocument();
  });

  it("clears the transcript viewport without changing the workspace session", async () => {
    mockedInitializeShell.mockResolvedValueOnce({
      ok: true,
      session: {
        cwd: "/workspace",
        revision: 4,
        history: [
          {
            command: "echo persisted",
            stdout: "persisted\n",
            stderr: "",
            exitCode: 0,
          },
        ],
      },
    });

    render(<TerminalShell />);
    expect(await screen.findByText("echo persisted")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear view/ }));

    expect(screen.queryByText("echo persisted")).not.toBeInTheDocument();
    expect(screen.getByText("revision 4", { exact: true })).toBeInTheDocument();
    expect(
      screen.getByText("Viewport cleared. Workspace data is unchanged."),
    ).toBeInTheDocument();
  });
});
