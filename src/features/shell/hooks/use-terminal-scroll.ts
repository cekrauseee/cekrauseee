import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const GESTURE_PIXELS_PER_LINE = 24;
const KEYBOARD_PAGE_LINES = 8;

function normalizedDelta(event: WheelEvent, lineHeight: number) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * lineHeight;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * window.innerHeight;
  }

  return event.deltaY;
}

export function useTerminalScroll() {
  const viewportRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const maxLineOffsetRef = useRef(0);
  const gestureRemainderRef = useRef(0);
  const followsOutputRef = useRef(true);
  const touchYRef = useRef<number | null>(null);
  const [lineOffset, setLineOffset] = useState(0);

  const moveByLines = useCallback((lineDelta: number) => {
    if (lineDelta === 0) return;

    setLineOffset((current) => {
      const maximum = maxLineOffsetRef.current;
      const next = Math.min(Math.max(current + lineDelta, 0), maximum);
      followsOutputRef.current = next === maximum;

      if (next === current) {
        gestureRemainderRef.current = 0;
      }

      return next;
    });
  }, []);

  const consumeGestureDelta = useCallback(
    (pixelDelta: number) => {
      gestureRemainderRef.current += pixelDelta;

      const lineDelta =
        gestureRemainderRef.current > 0
          ? Math.floor(gestureRemainderRef.current / GESTURE_PIXELS_PER_LINE)
          : Math.ceil(gestureRemainderRef.current / GESTURE_PIXELS_PER_LINE);

      if (lineDelta === 0) return;

      gestureRemainderRef.current -= lineDelta * GESTURE_PIXELS_PER_LINE;
      moveByLines(lineDelta);
    },
    [moveByLines],
  );

  const scrollToEnd = useCallback(() => {
    followsOutputRef.current = true;
    gestureRemainderRef.current = 0;
    setLineOffset(maxLineOffsetRef.current);
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(track).lineHeight);
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;

      const scrollablePixels = Math.max(
        track.scrollHeight - viewport.clientHeight,
        0,
      );
      const maximum = Math.ceil(scrollablePixels / lineHeight);
      maxLineOffsetRef.current = maximum;

      setLineOffset((current) =>
        followsOutputRef.current
          ? maximum
          : Math.min(Math.max(current, 0), maximum),
      );
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(track);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const lineHeight = Number.parseFloat(
        getComputedStyle(viewport).lineHeight,
      );
      consumeGestureDelta(normalizedDelta(event, lineHeight));
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touchYRef.current = null;
        return;
      }

      touchYRef.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const previousY = touchYRef.current;
      const currentY = event.touches[0]?.clientY;
      if (previousY === null || currentY === undefined) return;

      event.preventDefault();
      touchYRef.current = currentY;
      consumeGestureDelta(previousY - currentY);
    };

    const onTouchEnd = () => {
      touchYRef.current = null;
      gestureRemainderRef.current = 0;
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!event.shiftKey) return;

      if (event.key === "PageUp") {
        event.preventDefault();
        moveByLines(-KEYBOARD_PAGE_LINES);
      } else if (event.key === "PageDown") {
        event.preventDefault();
        moveByLines(KEYBOARD_PAGE_LINES);
      }
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: false });
    viewport.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [consumeGestureDelta, moveByLines]);

  return {
    lineOffset,
    scrollToEnd,
    trackRef,
    viewportRef,
  };
}
