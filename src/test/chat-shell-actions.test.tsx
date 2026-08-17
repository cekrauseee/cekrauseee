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

import { executeShellCommand, initializeShell } from "@/features/shell/actions";
import { ChatShell } from "@/features/chat/components/chat-shell";

vi.mock("@/features/shell/actions", () => ({
  executeShellCommand: vi.fn(),
  initializeShell: vi.fn(),
}));

const mockedInitializeShell = vi.mocked(initializeShell);
const mockedExecuteShellCommand = vi.mocked(executeShellCommand);

describe("ChatShell shell action wiring", () => {
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
  });

  it("hydrates the existing hierarchy and executes through shell actions", async () => {
    const { container } = render(<ChatShell />);

    await waitFor(() => expect(mockedInitializeShell).toHaveBeenCalledTimes(1));
    expect(
      container.querySelector(".shell__track .shell__inner"),
    ).toBeInTheDocument();
    expect(container.querySelector(".conversation")).toBeInTheDocument();
    expect(container.querySelector(".composer")).toBeInTheDocument();
    expect(screen.getByText("pwd")).toBeInTheDocument();
    expect(screen.getByText("/workspace")).toBeInTheDocument();

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
});
