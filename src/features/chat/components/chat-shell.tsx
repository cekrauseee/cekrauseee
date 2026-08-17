"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type SubmitEvent,
} from "react";
import {
  executeShellCommand,
  initializeShell,
  type ShellHistoryEntry,
} from "../../shell/actions";
import { usePromptHistory } from "../hooks/use-prompt-history";
import { useTerminalScroll } from "../hooks/use-terminal-scroll";
import { BlockCursorInput } from "./block-cursor-input";
import { PromptPrefix } from "./prompt-prefix";

const RUNNING_LABEL = "Running";

type TerminalEntry =
  { kind: "command"; content: string } | { kind: "output"; content: string };

function outputFrom(result: Pick<ShellHistoryEntry, "stdout" | "stderr">) {
  return `${result.stdout}${result.stderr}`;
}

function entriesFrom(history: ShellHistoryEntry[]): TerminalEntry[] {
  return history.flatMap((entry) => {
    const output = outputFrom(entry);
    return output
      ? [
          { kind: "command" as const, content: entry.command },
          { kind: "output" as const, content: output },
        ]
      : [{ kind: "command" as const, content: entry.command }];
  });
}

export function ChatShell() {
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestEpoch = useRef(0);
  const { next, previous, record, resetCursor, restore } = usePromptHistory();
  const { lineOffset, scrollToEnd, trackRef, viewportRef } =
    useTerminalScroll();

  const focusPromptAtEnd = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.disabled) return;

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const clearShell = useCallback(() => {
    requestEpoch.current += 1;
    setEntries([]);
    setPrompt("");
    setPending(false);
    setError(null);
    setAnnouncement("Terminal cleared.");
    resetCursor();
    requestAnimationFrame(focusPromptAtEnd);
  }, [focusPromptAtEnd, resetCursor]);

  useEffect(() => {
    let active = true;

    void initializeShell()
      .then((result) => {
        if (!active) return;

        if (!result.ok) {
          setError(result.error);
          setAnnouncement(`Terminal initialization failed: ${result.error}`);
          return;
        }

        setEntries(entriesFrom(result.session.history));
        restore(result.session.history.map((entry) => entry.command));
        setAnnouncement("Terminal ready.");
      })
      .catch(() => {
        if (!active) return;
        const message = "The shell could not be initialized. Try reloading.";
        setError(message);
        setAnnouncement(message);
      })
      .finally(() => {
        if (!active) return;
        setInitializing(false);
        requestAnimationFrame(focusPromptAtEnd);
      });

    return () => {
      active = false;
    };
  }, [focusPromptAtEnd, restore]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        clearShell();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearShell]);

  useEffect(() => {
    scrollToEnd();
  }, [entries, error, initializing, pending, scrollToEnd]);

  const submitPrompt = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const content = prompt.trim();
    if (!content || initializing || pending) return;

    const epoch = requestEpoch.current;

    setEntries((current) => [...current, { kind: "command", content }]);
    setPrompt("");
    setPending(true);
    setError(null);
    setAnnouncement("Running command.");
    record(content);

    try {
      const result = await executeShellCommand({
        command: content,
        requestId: crypto.randomUUID(),
      });
      if (epoch !== requestEpoch.current) return;

      if (!result.ok) {
        setError(result.error);
        setAnnouncement(`Message failed: ${result.error}`);
        return;
      }

      const output = outputFrom(result.result);
      if (output) {
        setEntries((current) => [
          ...current,
          { kind: "output", content: output },
        ]);
      }
      setAnnouncement(
        result.result.exitCode === 0
          ? "Command completed."
          : `Command exited with status ${result.result.exitCode}.`,
      );
    } catch {
      if (epoch !== requestEpoch.current) return;
      const message = "The command could not be run. Try it again.";
      setError(message);
      setAnnouncement(message);
    } finally {
      if (epoch === requestEpoch.current) {
        setPending(false);
        requestAnimationFrame(focusPromptAtEnd);
      }
    }
  };

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "ArrowUp" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      setPrompt(previous(event.currentTarget.value));
      return;
    }

    if (event.key === "ArrowDown" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      setPrompt(next());
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const onShellClick = (event: MouseEvent<HTMLElement>) => {
    if (event.detail === 0) return;
    if (event.target instanceof Element && event.target.closest("textarea")) {
      return;
    }

    requestAnimationFrame(focusPromptAtEnd);
  };

  return (
    <main
      className="shell"
      id="main-content"
      ref={viewportRef}
      onClick={onShellClick}
    >
      <div
        className="shell__track"
        ref={trackRef}
        style={{ translate: `0 ${-lineOffset}lh` }}
      >
        <div className="shell__inner">
          <h1 className="sr-only">shell interactive shell</h1>

          <ol className="conversation" aria-label="Terminal transcript">
            {entries.map((entry, index) => (
              <li
                className="conversation__entry"
                key={`${entry.kind}-${index}`}
              >
                {entry.kind === "command" ? (
                  <div className="prompt-line">
                    <PromptPrefix />
                    <span className="command">{entry.content}</span>
                  </div>
                ) : (
                  <div className="response">
                    <span className="command">{entry.content}</span>
                  </div>
                )}
              </li>
            ))}

            {pending && (
              <li className="conversation__entry" aria-hidden="true">
                <p className="pending">
                  <span className="pending__shimmer">
                    {Array.from(RUNNING_LABEL).map((character, index) => (
                      <span
                        className="pending__shimmer-character"
                        style={{ animationDelay: `${index * 80}ms` }}
                        key={`${character}-${index}`}
                      >
                        {character}
                      </span>
                    ))}
                  </span>
                </p>
              </li>
            )}
          </ol>

          {!initializing && !pending && (
            <form
              className="composer"
              onSubmit={submitPrompt}
              aria-label="Run a shell command"
            >
              <label className="sr-only" htmlFor="terminal-prompt">
                Command
              </label>
              <div className="prompt-line">
                <PromptPrefix />
                <BlockCursorInput
                  textareaRef={textareaRef}
                  value={prompt}
                  disabled={false}
                  invalid={Boolean(error)}
                  errorMessageId={error ? "prompt-error" : undefined}
                  onChange={setPrompt}
                  onKeyDown={onPromptKeyDown}
                />
              </div>

              {error && (
                <p className="error" id="prompt-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}

          <div
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {announcement}
          </div>
        </div>
      </div>
    </main>
  );
}
