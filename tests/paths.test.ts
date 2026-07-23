import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

const XDG_VARS = ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"] as const;

async function loadPaths() {
  vi.resetModules();
  return import("../src/lib/paths.ts");
}

describe("paths (XDG)", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const v of XDG_VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterEach(() => {
    for (const v of XDG_VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it("classifies files by kind: apps.json → cache, cookies.json → state", async () => {
    const p = await loadPaths();
    expect(p.APPS_FILE).toBe(join(homedir(), ".cache", "slack2", "apps.json"));
    expect(p.COOKIES_FILE).toBe(join(homedir(), ".local", "state", "slack2", "cookies.json"));
    expect(p.CONFIG_DIR).toBe(join(homedir(), ".config", "slack2"));
  });

  it("honors absolute XDG_* env vars", async () => {
    process.env.XDG_CACHE_HOME = "/custom/cache";
    process.env.XDG_STATE_HOME = "/custom/state";
    process.env.XDG_CONFIG_HOME = "/custom/config";
    const p = await loadPaths();
    expect(p.APPS_FILE).toBe("/custom/cache/slack2/apps.json");
    expect(p.COOKIES_FILE).toBe("/custom/state/slack2/cookies.json");
    expect(p.CONFIG_DIR).toBe("/custom/config/slack2");
  });

  it("ignores a relative XDG value (spec: only absolute paths are honored)", async () => {
    process.env.XDG_CACHE_HOME = "relative/path";
    const p = await loadPaths();
    expect(p.APPS_FILE).toBe(join(homedir(), ".cache", "slack2", "apps.json"));
  });
});
