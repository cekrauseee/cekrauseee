import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useAutosizeTextarea } from "../hooks/use-autosize-textarea";

const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const graphemeExtension = /^(?:\p{Mark}|\p{Emoji_Modifier}|\uFE0E|\uFE0F)$/u;
const regionalIndicator = /^\p{Regional_Indicator}$/u;
const zeroWidthJoiner = "\u200D";

type Grapheme = {
  segment: string;
  index: number;
};

type BlockCursorInputProps = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  disabled: boolean;
  invalid: boolean;
  errorMessageId?: string;
  completionMenuId?: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur: () => void;
};

function getCaretIndex(textarea: HTMLTextAreaElement) {
  if (textarea.selectionStart === textarea.selectionEnd) {
    return textarea.selectionStart;
  }

  return textarea.selectionDirection === "backward"
    ? textarea.selectionStart
    : textarea.selectionEnd;
}

function fallbackGraphemes(value: string): Grapheme[] {
  const graphemes: Grapheme[] = [];
  let offset = 0;

  for (const symbol of value) {
    const current = graphemes.at(-1);
    const currentIsOddRegionalRun =
      current !== undefined &&
      Array.from(current.segment).every((part) =>
        regionalIndicator.test(part),
      ) &&
      Array.from(current.segment).length % 2 === 1;
    const joinsCurrent =
      current !== undefined &&
      (symbol === zeroWidthJoiner ||
        current.segment.endsWith(zeroWidthJoiner) ||
        graphemeExtension.test(symbol) ||
        (regionalIndicator.test(symbol) && currentIsOddRegionalRun));

    if (joinsCurrent) {
      current.segment += symbol;
    } else {
      graphemes.push({ segment: symbol, index: offset });
    }

    offset += symbol.length;
  }

  return graphemes;
}

function graphemeAtSelection(value: string, selectionIndex: number) {
  const clampedIndex = Math.min(Math.max(selectionIndex, 0), value.length);

  if (clampedIndex === value.length) {
    return { before: value, current: "", after: "" };
  }

  const graphemes: Iterable<Grapheme> = graphemeSegmenter
    ? graphemeSegmenter.segment(value)
    : fallbackGraphemes(value);

  for (const grapheme of graphemes) {
    const graphemeEnd = grapheme.index + grapheme.segment.length;

    if (clampedIndex >= grapheme.index && clampedIndex < graphemeEnd) {
      return {
        before: value.slice(0, grapheme.index),
        current: grapheme.segment,
        after: value.slice(graphemeEnd),
      };
    }
  }

  return { before: value, current: "", after: "" };
}

export function BlockCursorInput({
  textareaRef,
  value,
  disabled,
  invalid,
  errorMessageId,
  completionMenuId,
  onChange,
  onKeyDown,
  onBlur,
}: BlockCursorInputProps) {
  const [caretIndex, setCaretIndex] = useState(value.length);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [isComposing, setIsComposing] = useState(false);

  useAutosizeTextarea(textareaRef, value);

  const syncCaret = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    setCaretIndex(getCaretIndex(textarea));
    setScroll({ left: textarea.scrollLeft, top: textarea.scrollTop });
  }, [textareaRef]);

  useLayoutEffect(syncCaret, [syncCaret, value]);

  useEffect(() => {
    const onSelectionChange = () => {
      if (document.activeElement === textareaRef.current) syncCaret();
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [syncCaret, textareaRef]);

  const grapheme = graphemeAtSelection(value, caretIndex);
  const isLineBreak = grapheme.current === "\n";
  const afterCaret = isLineBreak
    ? `${grapheme.current}${grapheme.after}`
    : grapheme.after;

  return (
    <span className="block-input" data-composing={isComposing || undefined}>
      <textarea
        ref={textareaRef}
        className="composer__textarea"
        id="terminal-prompt"
        name="message"
        value={value}
        rows={1}
        wrap="off"
        autoComplete="off"
        spellCheck="true"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-errormessage={errorMessageId}
        aria-controls={completionMenuId}
        aria-keyshortcuts="Enter Control+C Tab Shift+Tab Escape ArrowUp ArrowDown Shift+PageUp Shift+PageDown Control+L Meta+L"
        onChange={(event) => {
          onChange(event.currentTarget.value);
          setCaretIndex(getCaretIndex(event.currentTarget));
        }}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(event) => {
          setIsComposing(false);
          setCaretIndex(getCaretIndex(event.currentTarget));
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onScroll={(event) => {
          setScroll({
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          });
        }}
        onSelect={syncCaret}
      />
      <span
        className="block-input__mirror"
        style={{
          translate: `${-scroll.left}px ${-scroll.top}px`,
        }}
        aria-hidden="true"
      >
        {grapheme.before}
        <span className="block-cursor">
          {grapheme.current && !isLineBreak ? grapheme.current : "\u00a0"}
        </span>
        {afterCaret}
      </span>
    </span>
  );
}
