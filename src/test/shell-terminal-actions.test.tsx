import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  clearShellHistory,
  completeShellInput,
  executeShellCommand,
  initializeShell,
  type ExecuteShellCommandResult,
} from "@/features/shell/actions";
import { ShellTerminal } from "@/features/shell/components/shell-terminal";

vi.mock("@/features/shell/actions", () => ({
  clearShellHistory: vi.fn(),
  completeShellInput: vi.fn(),
  executeShellCommand: vi.fn(),
  initializeShell: vi.fn(),
}));

const mockedInitializeShell = vi.mocked(initializeShell);
const mockedClearShellHistory = vi.mocked(clearShellHistory);
const mockedExecuteShellCommand = vi.mocked(executeShellCommand);
const mockedCompleteShellInput = vi.mocked(completeShellInput);

describe("ShellTerminal action wiring", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mockedClearShellHistory.mockResolvedValue({ ok: true });
    mockedInitializeShell.mockResolvedValue({
      ok: true,
      session: {
        cwd: "/workspace",
        revision: 3,
        history: [
          {
            command: "pwd",
            stdout: "/workspace\n",
            stderr: "",
            exitCode: 0,
            cwd: "/workspace",
          },
        ],
      },
    });
    mockedExecuteShellCommand.mockResolvedValue({
      ok: true,
      result: {
        command: "printf hello",
        stdout: "hello",
        stderr: "",
        exitCode: 0,
        cwd: "/workspace",
        revision: 4,
      },
    });
    mockedCompleteShellInput.mockResolvedValue({
      ok: true,
      completion: { candidates: [], start: 0, end: 0 },
    });
  });

  it("hydrates the existing hierarchy and executes through shell actions", async () => {
    const { container } = render(<ShellTerminal />);

    await waitFor(() => expect(mockedInitializeShell).toHaveBeenCalledTimes(1));
    expect(
      container.querySelector(".shell__track .shell__inner"),
    ).toBeInTheDocument();
    expect(container.querySelector(".conversation")).toBeInTheDocument();
    expect(container.querySelector(".composer")).toBeInTheDocument();
    expect(screen.getByText("pwd")).toBeInTheDocument();
    expect(screen.getByText("/workspace")).toBeInTheDocument();
    expect(screen.getAllByText("~")).toHaveLength(2);

    const composer = screen.getByRole("form", { name: "Run a shell command" });
    const input = within(composer).getByRole("textbox", { name: "Command" });
    fireEvent.change(input, { target: { value: "printf hello" } });
    fireEvent.submit(composer);

    await waitFor(() =>
      expect(mockedExecuteShellCommand).toHaveBeenCalledWith({
        command: "printf hello",
        requestId: expect.any(String),
      }),
    );
    expect(await screen.findByText("hello")).toBeInTheDocument();
  });

  it("shows the current workspace path after changing directories", async () => {
    mockedExecuteShellCommand.mockResolvedValueOnce({
      ok: true,
      result: {
        command: "cd projects",
        stdout: "",
        stderr: "",
        exitCode: 0,
        cwd: "/workspace/projects",
        revision: 4,
      },
    });

    render(<ShellTerminal />);
    const composer = await screen.findByRole("form", {
      name: "Run a shell command",
    });
    const input = within(composer).getByRole("textbox", { name: "Command" });
    fireEvent.change(input, { target: { value: "cd projects" } });
    fireEvent.submit(composer);

    expect(
      await screen.findByLabelText("Current directory: ~/projects"),
    ).toBeInTheDocument();
  });

  it("renders multiline output inline with the terminal transcript", async () => {
    mockedExecuteShellCommand.mockResolvedValueOnce({
      ok: true,
      result: {
        command: "history",
        stdout: "    1  pwd\n    2  history\n",
        stderr: "",
        exitCode: 0,
        cwd: "/workspace",
        revision: 4,
      },
    });

    render(<ShellTerminal />);
    const input = await screen.findByRole("textbox", { name: "Command" });
    fireEvent.change(input, { target: { value: "history" } });
    fireEvent.submit(screen.getByRole("form", { name: "Run a shell command" }));

    const output = await screen.findByText(
      (_content, element) =>
        element?.tagName === "SPAN" &&
        element.classList.contains("command") &&
        element.textContent === "    1  pwd\n    2  history\n",
    );
    expect(output).toHaveClass("command");
    expect(output.parentElement).toHaveClass("response");
  });

  it("clears the persisted transcript with clear and Control+L", async () => {
    render(<ShellTerminal />);
    const input = await screen.findByRole("textbox", { name: "Command" });
    fireEvent.change(input, { target: { value: "clear" } });
    fireEvent.submit(screen.getByRole("form", { name: "Run a shell command" }));

    await waitFor(() =>
      expect(mockedClearShellHistory).toHaveBeenCalledTimes(1),
    );
    expect(mockedExecuteShellCommand).not.toHaveBeenCalled();
    expect(screen.queryByText("pwd")).toBeNull();

    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    await waitFor(() =>
      expect(mockedClearShellHistory).toHaveBeenCalledTimes(2),
    );
  });

  it("completes one candidate with Tab", async () => {
    mockedCompleteShellInput.mockResolvedValueOnce({
      ok: true,
      completion: { candidates: ["readme.md"], start: 4, end: 6 },
    });

    render(<ShellTerminal />);
    const input = await screen.findByRole("textbox", { name: "Command" });
    fireEvent.change(input, { target: { value: "cat re" } });
    fireEvent.keyDown(input, { key: "Tab" });

    await waitFor(() =>
      expect(mockedCompleteShellInput).toHaveBeenCalledWith({
        input: "cat re",
        cursor: 6,
      }),
    );
    expect(input).toHaveValue("cat readme.md");
    expect(screen.queryByLabelText("Completion candidates")).toBeNull();
  });

  it("keeps the prompt focused and disables native line wrapping", async () => {
    render(<ShellTerminal />);
    const input = await screen.findByRole("textbox", { name: "Command" });

    expect(input).toHaveAttribute("wrap", "off");
    input.focus();
    input.blur();

    await waitFor(() => expect(input).toHaveFocus());
  });

  it("submits with Enter, starts a new prompt for a blank command, and ignores Shift+Enter", async () => {
    render(<ShellTerminal />);
    const input = await screen.findByRole("textbox", { name: "Command" });

    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(mockedExecuteShellCommand).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getAllByLabelText("Current directory: ~")).toHaveLength(3),
    );
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(
      false,
    );
    expect(mockedExecuteShellCommand).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "printf one\nprintf two" } });
    expect(input).toHaveValue("printf one");
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);

    await waitFor(() =>
      expect(mockedExecuteShellCommand).toHaveBeenCalledWith({
        command: "printf one",
        requestId: expect.any(String),
      }),
    );
    expect(input).toHaveAttribute(
      "aria-keyshortcuts",
      expect.stringContaining("Enter"),
    );
  });

  it("interrupts an in-flight command with Control+C and discards its late result", async () => {
    let resolveCommand!: (result: ExecuteShellCommandResult) => void;
    mockedExecuteShellCommand.mockImplementationOnce(
      () =>
        new Promise<ExecuteShellCommandResult>((resolve) => {
          resolveCommand = resolve;
        }),
    );

    render(<ShellTerminal />);
    const input = await screen.findByRole("textbox", { name: "Command" });
    fireEvent.change(input, { target: { value: "sleep 1" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(input).toBeDisabled());
    expect(fireEvent.keyDown(window, { key: "c", ctrlKey: true })).toBe(false);
    expect(await screen.findByText("sleep 1^C")).toBeInTheDocument();
    expect(screen.queryByText("^C")).toBeNull();
    expect(input).not.toBeDisabled();
    expect(input).toHaveAttribute(
      "aria-keyshortcuts",
      expect.stringContaining("Control+C"),
    );

    resolveCommand({
      ok: true,
      result: {
        command: "sleep 1",
        stdout: "late result\n",
        stderr: "",
        exitCode: 0,
        cwd: "/workspace",
        revision: 4,
      },
    });

    await waitFor(() => expect(screen.queryByText("late result")).toBeNull());
  });

  it("cycles completion candidates with Tab and closes the menu with Escape", async () => {
    mockedCompleteShellInput.mockResolvedValueOnce({
      ok: true,
      completion: {
        candidates: ["readme.md", "report.md"],
        start: 4,
        end: 6,
      },
    });

    render(<ShellTerminal />);
    const input = await screen.findByRole("textbox", { name: "Command" });
    fireEvent.change(input, { target: { value: "cat re" } });
    fireEvent.keyDown(input, { key: "Tab" });

    expect(
      await screen.findByLabelText("Completion candidates"),
    ).toBeInTheDocument();
    expect(input).toHaveValue("cat readme.md");

    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("cat report.md");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("Completion candidates")).toBeNull();
  });
});
