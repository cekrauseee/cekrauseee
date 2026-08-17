import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const integration = process.env.VITEST_INTEGRATION === "1";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // `workspace-fs` is server-only in the Next runtime. The test suite
      // exercises its pure filesystem functions without a React server
      // boundary.
      "server-only": new URL("./src/test/server-only.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    environment: integration ? "node" : "jsdom",
    include: integration
      ? ["src/test/integration/**/*.test.ts"]
      : ["src/test/**/*.test.{ts,tsx}"],
    exclude: integration ? [] : ["src/test/integration/**"],
    setupFiles: integration ? [] : ["./src/test/setup.ts"],
    clearMocks: true,
  },
});
