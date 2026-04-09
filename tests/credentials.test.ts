import { describe, it, expect, vi, afterEach } from "vitest";

describe("credentials", () => {
  describe("getWorkspaceToken", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("should throw if credentials file does not exist", async () => {
      // Mock fs.existsSync to return false
      vi.mock("node:fs", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:fs")>();
        return {
          ...actual,
          existsSync: () => false,
        };
      });

      // Need fresh import after mock
      vi.resetModules();
      const { getWorkspaceToken } = await import("../src/lib/credentials.ts");
      await expect(getWorkspaceToken("test")).rejects.toThrow(
        "credentials.json",
      );

      vi.unmock("node:fs");
    });
  });

  describe("listWorkspaces", () => {
    it("should return empty array if no credentials file", async () => {
      vi.mock("node:fs", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:fs")>();
        return {
          ...actual,
          existsSync: () => false,
        };
      });

      vi.resetModules();
      const { listWorkspaces } = await import("../src/lib/credentials.ts");
      const result = await listWorkspaces();
      expect(result).toEqual([]);

      vi.unmock("node:fs");
    });
  });
});
