import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("slackApi", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should call correct URL with auth header", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";

    globalThis.fetch = vi.fn(async (url: any, opts: any) => {
      capturedUrl = url as string;
      capturedHeaders = Object.fromEntries(
        Object.entries(opts.headers as Record<string, string>),
      );
      capturedBody = opts.body as string;
      return new Response(JSON.stringify({ ok: true, app_id: "A123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const { slackApi } = await import("../src/lib/slack-api.ts");
    const result = await slackApi("apps.manifest.create", "xoxp-token", {
      manifest: { name: "test" },
    });

    expect(capturedUrl).toBe("https://slack.com/api/apps.manifest.create");
    expect(capturedHeaders["Authorization"]).toBe("Bearer xoxp-token");
    expect(capturedHeaders["Content-Type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(JSON.parse(capturedBody)).toEqual({ manifest: { name: "test" } });
    expect(result.ok).toBe(true);
    expect(result.app_id).toBe("A123");
  });

  it("should throw on non-ok response", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_auth" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const { slackApi } = await import("../src/lib/slack-api.ts");
    await expect(
      slackApi("auth.test", "bad-token"),
    ).rejects.toThrow("invalid_auth");
  });

  it("should work without body", async () => {
    let capturedBody: string | undefined;

    globalThis.fetch = vi.fn(async (_url: any, opts: any) => {
      capturedBody = opts.body;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const { slackApi } = await import("../src/lib/slack-api.ts");
    await slackApi("auth.test", "xoxp-token");

    expect(capturedBody).toBeUndefined();
  });
});
