import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom does not provide animation frames unless pretendToBeVisual is set.
// The terminal only needs a schedulable callback for focus and scroll work.
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
  setTimeout(
    () => callback(Date.now()),
    0,
  )) as unknown as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = ((handle: number) =>
  clearTimeout(handle)) as typeof cancelAnimationFrame;
