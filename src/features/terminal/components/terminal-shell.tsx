"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type SubmitEvent,
} from "react";
import { executeShellCommand, initializeShell } from "@/features/shell/actions";

type ShellFailure = { ok: false; error: string; code?: string };
type ShellHistoryItem = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};
type ShellSession = {
  cwd: string;
  revision: number;
  history: ShellHistoryItem[];
};
type ShellResult = ShellHistoryItem & { cwd: string; revision: number };
type TerminalEntry = ShellHistoryItem & {
  id: string;
  cwd?: string;
  pending?: boolean;
  error?: string;
  errorCode?: string;
};

const DEFAULT_CWD = "~";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseFailure(value: unknown): ShellFailure | null {
  if (
    !isRecord(value) ||
    value.ok !== false ||
    typeof value.error !== "string"
  ) {
    return null;
  }
  return {
    ok: false,
    error: value.error,
    ...(typeof value.code === "string" ? { code: value.code } : {}),
  };
}

function parseHistoryItem(value: unknown): ShellHistoryItem | null {
  if (
    !isRecord(value) ||
    typeof value.command !== "string" ||
    typeof value.stdout !== "string" ||
    typeof value.stderr !== "string" ||
    typeof value.exitCode !== "number"
  ) {
    return null;
  }
  return {
    command: value.command,
    stdout: value.stdout,
    stderr: value.stderr,
    exitCode: value.exitCode,
  };
}

function parseSession(value: unknown): ShellSession | ShellFailure {
  const failure = parseFailure(value);
  if (failure) return failure;
  const payload =
    isRecord(value) && value.ok === true && isRecord(value.session)
      ? value.session
      : value;
  if (
    !isRecord(payload) ||
    typeof payload.cwd !== "string" ||
    typeof payload.revision !== "number" ||
    !Array.isArray(payload.history)
  ) {
    return {
      ok: false,
      error: "The shell session could not be read.",
      code: "INVALID_SESSION",
    };
  }
  return {
    cwd: payload.cwd,
    revision: payload.revision,
    history: payload.history
      .map(parseHistoryItem)
      .filter((item): item is ShellHistoryItem => item !== null),
  };
}

function parseResult(value: unknown): ShellResult | ShellFailure {
  const failure = parseFailure(value);
  if (failure) return failure;
  const payload =
    isRecord(value) && value.ok === true && isRecord(value.result)
      ? value.result
      : value;
  const item = parseHistoryItem(payload);
  if (
    !isRecord(payload) ||
    !item ||
    typeof payload.cwd !== "string" ||
    typeof payload.revision !== "number"
  ) {
    return {
      ok: false,
      error: "The shell returned an invalid command result.",
      code: "INVALID_RESULT",
    };
  }
  return { ...item, cwd: payload.cwd, revision: payload.revision };
}

function isFailure(
  value: ShellFailure | ShellSession | ShellResult,
): value is ShellFailure {
  return "ok" in value && value.ok === false;
}

function makeRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `shell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function promptForCwd(cwd: string) {
  const displayCwd = cwd.trim() || DEFAULT_CWD;
  return `guest@shell:${displayCwd} $`;
}

function entryFromHistory(
  item: ShellHistoryItem,
  index: number,
): TerminalEntry {
  return { ...item, id: `history-${index}` };
}

function failureMessage(failure: ShellFailure) {
  return failure.code ? `${failure.error} [${failure.code}]` : failure.error;
}

export function TerminalShell() {
  const [session, setSession] = useState({ cwd: DEFAULT_CWD, revision: 0 });
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [busy, setBusy] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("Connecting to the shell.");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const draftRef = useRef("");
  const requestNumberRef = useRef(0);

  const focusEditor = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.disabled) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const resizeEditor = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 176)}px`;
  }, []);

  const bootstrapShell = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setInitializing(true);
    setInitializationError(null);
    setAnnouncement("Connecting to the shell.");

    try {
      const result = parseSession(await initializeShell());
      if (!mountedRef.current) return;
      if (isFailure(result)) {
        setInitializationError(failureMessage(result));
        setAnnouncement(
          `Shell initialization failed: ${failureMessage(result)}`,
        );
        return;
      }
      setSession({ cwd: result.cwd, revision: result.revision });
      setEntries((current) =>
        current.length > 0 ? current : result.history.map(entryFromHistory),
      );
      setCommandHistory((current) => {
        const persisted = result.history.map((item) => item.command);
        return [...new Set([...current, ...persisted])];
      });
      setAnnouncement(
        result.history.length > 0
          ? `Shell ready. Restored ${result.history.length} command${result.history.length === 1 ? "" : "s"}.`
          : "Shell ready.",
      );
    } catch {
      if (!mountedRef.current) return;
      const message =
        "The shell could not be initialized. Try connecting again.";
      setInitializationError(message);
      setAnnouncement(message);
    } finally {
      if (!mountedRef.current) return;
      busyRef.current = false;
      setBusy(false);
      setInitializing(false);
      requestAnimationFrame(focusEditor);
    }
  }, [focusEditor]);

  useEffect(() => {
    mountedRef.current = true;
    const frame = requestAnimationFrame(() => void bootstrapShell());
    return () => {
      cancelAnimationFrame(frame);
      mountedRef.current = false;
    };
  }, [bootstrapShell]);

  useEffect(() => {
    resizeEditor();
  }, [prompt, resizeEditor]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
  }, [entries, busy, initializationError]);

  const clearViewport = useCallback(() => {
    setEntries([]);
    setAnnouncement("Viewport cleared. Workspace data is unchanged.");
    requestAnimationFrame(focusEditor);
  }, [focusEditor]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        clearViewport();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearViewport]);

  const updateEntry = useCallback(
    (id: string, update: Partial<TerminalEntry>) => {
      setEntries((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, ...update } : entry,
        ),
      );
    },
    [],
  );

  const submitCommand = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || !prompt.trim()) return;

    const command = prompt.replace(/\r\n/g, "\n");
    const id = `command-${Date.now()}-${requestNumberRef.current}`;
    requestNumberRef.current += 1;
    const commandCwd = session.cwd;
    setEntries((current) => [
      ...current,
      {
        id,
        command,
        cwd: commandCwd,
        stdout: "",
        stderr: "",
        exitCode: 0,
        pending: true,
      },
    ]);
    setCommandHistory((current) =>
      current.at(-1) === command ? current : [...current, command],
    );
    setHistoryIndex(-1);
    draftRef.current = "";
    setPrompt("");
    busyRef.current = true;
    setBusy(true);
    setAnnouncement(`Running ${command.split("\n")[0]}.`);

    try {
      const result = parseResult(
        await executeShellCommand({ command, requestId: makeRequestId() }),
      );
      if (!mountedRef.current) return;
      if (isFailure(result)) {
        updateEntry(id, {
          pending: false,
          error: result.error,
          errorCode: result.code,
        });
        setAnnouncement(`Command failed: ${failureMessage(result)}`);
        return;
      }
      updateEntry(id, {
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        cwd: commandCwd,
        pending: false,
      });
      setSession({ cwd: result.cwd, revision: result.revision });
      setAnnouncement(
        result.exitCode === 0
          ? "Command finished successfully."
          : `Command exited with status ${result.exitCode}.`,
      );
    } catch {
      if (!mountedRef.current) return;
      const message = "The command could not be completed. Try it again.";
      updateEntry(id, { pending: false, error: message });
      setAnnouncement(message);
    } finally {
      if (!mountedRef.current) return;
      busyRef.current = false;
      setBusy(false);
      requestAnimationFrame(focusEditor);
    }
  };

  const onPromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setPrompt(value);
    setHistoryIndex(-1);
    draftRef.current = value;
  };

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !prompt.includes("\n") &&
      commandHistory.length > 0
    ) {
      event.preventDefault();
      if (event.key === "ArrowUp") {
        const nextIndex =
          historyIndex < 0
            ? commandHistory.length - 1
            : Math.max(0, historyIndex - 1);
        if (historyIndex < 0) draftRef.current = prompt;
        setHistoryIndex(nextIndex);
        setPrompt(commandHistory[nextIndex] ?? "");
      } else if (historyIndex >= 0) {
        const nextIndex = historyIndex + 1;
        if (nextIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setPrompt(draftRef.current);
        } else {
          setHistoryIndex(nextIndex);
          setPrompt(commandHistory[nextIndex] ?? "");
        }
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const status = initializing
    ? "connecting"
    : initializationError
      ? "offline"
      : "ready";

  return (
    <main
      className="terminal-page"
      id="main-content"
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("textarea, button, a")
        )
          return;
        requestAnimationFrame(focusEditor);
      }}
    >
      <section className="terminal" aria-labelledby="terminal-title">
        <header className="terminal__header">
          <div className="terminal__identity">
            <span className="terminal__mark" aria-hidden="true">
              &gt;_
            </span>
            <div>
              <h1 id="terminal-title">shell</h1>
              <p>persistent workspace</p>
            </div>
          </div>
          <div className="terminal__header-actions">
            <span className={`terminal__status terminal__status--${status}`}>
              <span className="terminal__status-dot" aria-hidden="true" />
              {status}
            </span>
            {initializationError && (
              <button
                className="terminal__text-button"
                type="button"
                onClick={() => void bootstrapShell()}
                disabled={busy}
              >
                Retry connection
              </button>
            )}
          </div>
        </header>

        <div className="terminal__meta" aria-label="Session details">
          <span>{promptForCwd(session.cwd)}</span>
          <span className="terminal__revision">
            revision {session.revision}
          </span>
        </div>

        <section
          className="terminal__viewport"
          aria-label="Shell transcript"
          ref={viewportRef}
          tabIndex={-1}
        >
          {initializing && entries.length === 0 && (
            <p className="terminal__system-line">
              Connecting to the persistent shell…
            </p>
          )}
          {initializationError && (
            <p className="terminal__error-line" role="alert">
              <span className="terminal__error-label">error</span>{" "}
              {initializationError}
            </p>
          )}
          <ol className="terminal__transcript" aria-label="Command history">
            {entries.map((entry) => (
              <li className="terminal__entry" key={entry.id}>
                <div className="terminal__command-line">
                  <span className="terminal__prompt" aria-hidden="true">
                    {promptForCwd(entry.cwd ?? session.cwd)}
                  </span>
                  <span className="terminal__command">{entry.command}</span>
                </div>
                {entry.pending ? (
                  <p className="terminal__pending" role="status">
                    running…
                  </p>
                ) : entry.error ? (
                  <p className="terminal__error-line" role="alert">
                    <span className="terminal__error-label">error</span>{" "}
                    {entry.error}
                    {entry.errorCode ? ` [${entry.errorCode}]` : ""}
                  </p>
                ) : (
                  <>
                    {entry.stdout && (
                      <pre className="terminal__output">{entry.stdout}</pre>
                    )}
                    {entry.stderr && (
                      <pre className="terminal__output terminal__output--stderr">
                        {entry.stderr}
                      </pre>
                    )}
                    {entry.exitCode !== 0 && (
                      <p className="terminal__exit-line">
                        exit status {entry.exitCode}
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>

        <form className="terminal__composer" onSubmit={submitCommand}>
          <div className="terminal__input-row">
            <span
              className="terminal__prompt terminal__prompt--input"
              aria-hidden="true"
            >
              {promptForCwd(session.cwd)}
            </span>
            <label className="sr-only" htmlFor="shell-command">
              Shell command
            </label>
            <textarea
              ref={textareaRef}
              id="shell-command"
              name="command"
              rows={1}
              value={prompt}
              onChange={onPromptChange}
              onKeyDown={onPromptKeyDown}
              placeholder={initializing ? "connecting…" : "type a command"}
              disabled={busy}
              aria-describedby="terminal-help terminal-status"
              aria-busy={busy}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button
              className="terminal__run"
              type="submit"
              disabled={busy || !prompt.trim()}
            >
              Run
            </button>
          </div>
          <div className="terminal__composer-footer">
            <p id="terminal-help">
              Enter to run · Shift+Enter for a multiline command
            </p>
            <button
              className="terminal__clear"
              type="button"
              onClick={clearViewport}
            >
              Clear view <span aria-hidden="true">⌘L</span>
            </button>
          </div>
        </form>
        <p
          className="sr-only"
          id="terminal-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </p>
      </section>
    </main>
  );
}
