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
  clearShellHistory,
  completeShellInput,
  executeShellCommand,
  initializeShell,
  type ShellHistoryEntry,
} from "@/features/shell/actions";
import { usePromptHistory } from "../hooks/use-prompt-history";
import { useTerminalScroll } from "../hooks/use-terminal-scroll";
import { BlockCursorInput } from "./block-cursor-input";
import { PromptPrefix } from "./prompt-prefix";

type TerminalEntry =
  | { kind: "command"; content: string; cwd: string }
  | { kind: "output"; content: string };

type CompletionMenu = {
  candidates: string[];
  start: number;
  end: number;
  selectedIndex: number;
};

function outputFrom(result: Pick<ShellHistoryEntry, "stdout" | "stderr">) {
  return `${result.stdout}${result.stderr}`;
}

function entriesFrom(history: ShellHistoryEntry[]): TerminalEntry[] {
  return history.flatMap((entry) => {
    const output = outputFrom(entry);
    return output
      ? [
          {
            kind: "command" as const,
            content: entry.command,
            cwd: entry.cwd,
          },
          { kind: "output" as const, content: output },
        ]
      : [
          {
            kind: "command" as const,
            content: entry.command,
            cwd: entry.cwd,
          },
        ];
  });
}

export function ShellTerminal() {
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [cwd, setCwd] = useState("/workspace");
  const [prompt, setPrompt] = useState("");
  const [completion, setCompletion] = useState<CompletionMenu | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestEpoch = useRef(0);
  const completionEpoch = useRef(0);
  const { next, previous, record, resetCursor, restore } = usePromptHistory();
  const { lineOffset, scrollToEnd, trackRef, viewportRef } =
    useTerminalScroll();

  const focusPromptAtEnd = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.disabled) return;

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const focusPromptAt = useCallback((position: number) => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.disabled) return;

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(position, position);
  }, []);

  const restorePromptFocus = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.disabled) return;

    const { selectionStart, selectionEnd } = textarea;
    requestAnimationFrame(() => {
      const current = textareaRef.current;
      if (
        !current ||
        current.disabled ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      current.focus({ preventScroll: true });
      current.setSelectionRange(selectionStart, selectionEnd);
    });
  }, []);

  const clearShell = useCallback(async () => {
    requestEpoch.current += 1;
    completionEpoch.current += 1;
    setEntries([]);
    setPrompt("");
    setCompletion(null);
    setPending(false);
    setError(null);
    setAnnouncement("Terminal cleared.");
    resetCursor();
    requestAnimationFrame(focusPromptAtEnd);

    try {
      const result = await clearShellHistory();
      if (result.ok) return;

      setError(result.error);
      setAnnouncement(`Terminal clear failed: ${result.error}`);
    } catch {
      const message = "The terminal could not be cleared. Try it again.";
      setError(message);
      setAnnouncement(message);
    }
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
        setCwd(result.session.cwd);
        setCompletion(null);
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
      if (event.key === "Tab") event.preventDefault();

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        void clearShell();
      }
    };

    const onWindowFocus = () => restorePromptFocus();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") restorePromptFocus();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [clearShell, restorePromptFocus]);

  useEffect(() => {
    scrollToEnd();
  }, [entries, error, initializing, pending, scrollToEnd]);

  const submitPrompt = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const content = prompt.trim();
    if (!content || initializing || pending) return;

    if (content === "clear") {
      await clearShell();
      return;
    }

    const epoch = requestEpoch.current;

    completionEpoch.current += 1;
    setEntries((current) => [...current, { kind: "command", content, cwd }]);
    setPrompt("");
    setCompletion(null);
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
      setCwd(result.result.cwd);
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

  const replaceCompletion = useCallback(
    (menu: CompletionMenu, selectedIndex: number) => {
      const candidate = menu.candidates[selectedIndex];
      const nextEnd = menu.start + candidate.length;

      setPrompt(
        (current) =>
          `${current.slice(0, menu.start)}${candidate}${current.slice(menu.end)}`,
      );
      setCompletion({ ...menu, end: nextEnd, selectedIndex });
      requestAnimationFrame(() => focusPromptAt(nextEnd));
    },
    [focusPromptAt],
  );

  const requestCompletion = useCallback(
    (textarea: HTMLTextAreaElement) => {
      const input = textarea.value;
      const cursor = textarea.selectionStart;
      const epoch = ++completionEpoch.current;

      void completeShellInput({ input, cursor })
        .then((result) => {
          if (
            epoch !== completionEpoch.current ||
            textareaRef.current?.value !== input
          ) {
            return;
          }

          if (!result.ok) {
            setAnnouncement(`Completion failed: ${result.error}`);
            return;
          }

          const { candidates, start, end } = result.completion;
          if (candidates.length === 0) {
            setCompletion(null);
            setAnnouncement("No completions found.");
            return;
          }

          if (candidates.length === 1) {
            const candidate = candidates[0];
            const nextEnd = start + candidate.length;
            setPrompt(
              `${input.slice(0, start)}${candidate}${input.slice(end)}`,
            );
            setCompletion(null);
            requestAnimationFrame(() => focusPromptAt(nextEnd));
            setAnnouncement("Completed.");
            return;
          }

          const menu = { candidates, start, end, selectedIndex: 0 };
          replaceCompletion(menu, 0);
          setAnnouncement(
            `${candidates.length} completions. Press Tab to cycle or Escape to close.`,
          );
        })
        .catch(() => {
          if (epoch !== completionEpoch.current) return;
          setAnnouncement("Completion could not be loaded.");
        });
    },
    [focusPromptAt, replaceCompletion],
  );

  const onPromptChange = useCallback((value: string) => {
    completionEpoch.current += 1;
    setCompletion(null);
    setPrompt(value);
  }, []);

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      if (event.nativeEvent.isComposing) return;

      if (completion) {
        const direction = event.shiftKey ? -1 : 1;
        const selectedIndex =
          (completion.selectedIndex +
            direction +
            completion.candidates.length) %
          completion.candidates.length;
        replaceCompletion(completion, selectedIndex);
      } else {
        requestCompletion(event.currentTarget);
      }
      return;
    }

    if (event.nativeEvent.isComposing) return;

    if (event.key === "Escape" && completion) {
      event.preventDefault();
      completionEpoch.current += 1;
      setCompletion(null);
      setAnnouncement("Completion menu closed.");
      return;
    }

    if (completion) setCompletion(null);

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
                    <PromptPrefix cwd={entry.cwd} />
                    <span className="command">{entry.content}</span>
                  </div>
                ) : (
                  <div className="response">
                    <span className="command">{entry.content}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>

          {!initializing && (
            <form
              className="composer"
              onSubmit={submitPrompt}
              aria-label="Run a shell command"
            >
              <label className="sr-only" htmlFor="terminal-prompt">
                Command
              </label>
              <div className="prompt-line">
                <PromptPrefix cwd={cwd} />
                <BlockCursorInput
                  textareaRef={textareaRef}
                  value={prompt}
                  disabled={pending}
                  invalid={Boolean(error)}
                  errorMessageId={error ? "prompt-error" : undefined}
                  completionMenuId={completion ? "completion-menu" : undefined}
                  onChange={onPromptChange}
                  onKeyDown={onPromptKeyDown}
                  onBlur={restorePromptFocus}
                />
              </div>

              {completion && completion.candidates.length > 1 && (
                <ul
                  className="completion-menu"
                  id="completion-menu"
                  aria-label="Completion candidates"
                >
                  {completion.candidates.map((candidate, index) => (
                    <li
                      className="completion-menu__candidate"
                      data-selected={
                        index === completion.selectedIndex || undefined
                      }
                      key={candidate}
                    >
                      {candidate}
                    </li>
                  ))}
                </ul>
              )}

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
