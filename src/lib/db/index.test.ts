import { describe, expect, it } from "vitest";

import { selectDatabaseDriver } from "./index";

describe("database driver selection", () => {
  it("uses transactional Neon Serverless on Vercel", () => {
    expect(selectDatabaseDriver({ VERCEL: "1" })).toBe("neon-serverless");
  });

  it("uses node-postgres outside Vercel", () => {
    expect(selectDatabaseDriver({ VERCEL: undefined })).toBe("node-postgres");
  });
});
