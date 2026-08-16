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
import { sendMessage } from "../actions";
import type { ChatMessage } from "../types";
import { usePromptHistory } from "../hooks/use-prompt-history";
import { BlockCursorInput } from "./block-cursor-input";
import { MarkdownResponse } from "./markdown-response";
import { PromptPrefix } from "./prompt-prefix";

export function ChatShell() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const requestEpoch = useRef(0);
  const { next, previous, record, resetCursor } = usePromptHistory();

  const focusPromptAtEnd = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.disabled) return;

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const clearShell = useCallback(() => {
    requestEpoch.current += 1;
    setMessages([]);
    setPrompt("");
    setPending(false);
    setError(null);
    setAnnouncement("Conversation cleared.");
    resetCursor();
    requestAnimationFrame(focusPromptAtEnd);
  }, [focusPromptAtEnd, resetCursor]);

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
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, pending, error]);

  const submitPrompt = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const content = prompt.trim();
    if (!content || pending) return;

    const userMessage: ChatMessage = { role: "user", content };
    const nextMessages = [...messages, userMessage];
    const epoch = requestEpoch.current;

    setMessages(nextMessages);
    setPrompt("");
    setPending(true);
    setError(null);
    setAnnouncement("Sending message.");
    record(content);

    try {
      const result = await sendMessage(nextMessages);
      if (epoch !== requestEpoch.current) return;

      if (!result.ok) {
        setError(result.error);
        setAnnouncement(`Message failed: ${result.error}`);
        return;
      }

      setMessages((current) => [...current, result.message]);
      setAnnouncement(`Response: ${result.message.content}`);
    } catch {
      if (epoch !== requestEpoch.current) return;
      const message =
        "The response could not be loaded. Try sending your message again.";
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
    <main className="shell" id="main-content" onClick={onShellClick}>
      <div className="shell__inner">
        <h1 className="sr-only">cekrauseee conversational shell</h1>

        <ol className="conversation" aria-label="Conversation">
          {messages.map((message, index) => (
            <li
              className="conversation__entry"
              key={`${message.role}-${index}`}
            >
              {message.role === "user" ? (
                <div className="prompt-line">
                  <PromptPrefix />
                  <span className="command">{message.content}</span>
                </div>
              ) : (
                <MarkdownResponse content={message.content} />
              )}
            </li>
          ))}
        </ol>

        <form
          className="composer"
          onSubmit={submitPrompt}
          aria-label="Send a message"
        >
          <label className="sr-only" htmlFor="terminal-prompt">
            Message
          </label>
          <div className="prompt-line">
            <PromptPrefix />
            <BlockCursorInput
              textareaRef={textareaRef}
              value={prompt}
              disabled={pending}
              invalid={Boolean(error)}
              errorMessageId={error ? "prompt-error" : undefined}
              onChange={setPrompt}
              onKeyDown={onPromptKeyDown}
            />
          </div>

          {pending && (
            <p className="pending" role="status">
              Thinking
            </p>
          )}

          {error && (
            <p className="error" id="prompt-error" role="alert">
              {error}
            </p>
          )}
        </form>

        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </div>
        <div ref={endRef} aria-hidden="true" />
      </div>
    </main>
  );
}
