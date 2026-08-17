import { useCallback, useRef, useState } from "react";

export function usePromptHistory() {
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const draft = useRef("");

  const record = useCallback((value: string) => {
    setHistory((current) => [...current, value]);
    setCursor(null);
    draft.current = "";
  }, []);

  const previous = useCallback(
    (currentValue: string) => {
      if (history.length === 0) return currentValue;

      if (cursor === null) draft.current = currentValue;
      const nextCursor =
        cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(nextCursor);
      return history[nextCursor];
    },
    [cursor, history],
  );

  const next = useCallback(() => {
    if (cursor === null) return draft.current;

    if (cursor >= history.length - 1) {
      setCursor(null);
      return draft.current;
    }

    const nextCursor = cursor + 1;
    setCursor(nextCursor);
    return history[nextCursor];
  }, [cursor, history]);

  const resetCursor = useCallback(() => {
    setCursor(null);
    draft.current = "";
  }, []);

  return { next, previous, record, resetCursor };
}
