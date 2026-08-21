import { useLayoutEffect, useRef, type RefObject } from "react";

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
  textarea.style.overflowY =
    textarea.scrollHeight > textarea.clientHeight ? "auto" : "hidden";
}

export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  const observedWidth = useRef<number | null>(null);

  useLayoutEffect(() => {
    const textarea = ref.current;

    if (!textarea) return;

    resizeTextarea(textarea);
  }, [ref, value]);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea || typeof ResizeObserver === "undefined") return;

    observedWidth.current = textarea.clientWidth;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const previousWidth = observedWidth.current;

      if (previousWidth !== null && Math.abs(width - previousWidth) < 0.5) {
        return;
      }

      observedWidth.current = width;
      resizeTextarea(textarea);
    });

    observer.observe(textarea);
    return () => observer.disconnect();
  }, [ref]);
}
