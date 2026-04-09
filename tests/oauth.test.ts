import { describe, it, expect, vi, afterEach } from "vitest";
import { redirectUri } from "../src/lib/oauth.ts";

describe("oauth", () => {
  describe("redirectUri", () => {
    it("should return localhost callback URL with default port", () => {
      expect(redirectUri()).toBe("http://localhost:9876/callback");
    });

    it("should accept custom port", () => {
      expect(redirectUri(3000)).toBe("http://localhost:3000/callback");
    });
  });

  describe("exchangeCodeForToken", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("should exchange code for token", async () => {
      let capturedBody = "";

      globalThis.fetch = vi.fn(async (_url: any, opts: any) => {
        capturedBody = opts.body.toString();
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: "xoxb-123-456",
            bot_user_id: "U789",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as any;

      const { exchangeCodeForToken } = await import("../src/lib/oauth.ts");
      const result = await exchangeCodeForToken(
        "code123",
        "client_id",
        "client_secret",
        "http://localhost:9876/callback",
      );

      expect(result.accessToken).toBe("xoxb-123-456");
      expect(result.botUserId).toBe("U789");
      expect(capturedBody).toContain("code=code123");
      expect(capturedBody).toContain("client_id=client_id");
    });

    it("should throw on failed exchange", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({ ok: false, error: "invalid_code" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as any;

      const { exchangeCodeForToken } = await import("../src/lib/oauth.ts");
      await expect(
        exchangeCodeForToken("bad", "c", "s", "http://localhost:9876/callback"),
      ).rejects.toThrow("invalid_code");
    });
  });
});
