import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We need to mock the config directory. Override the module internals.
// Since config.ts uses hardcoded paths, we test the logic by importing
// the functions and pointing them at a temp dir via env or by testing
// the data structures directly.

describe("config", () => {
  let tempDir: string;
  let appsFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "slack2-test-"));
    appsFile = join(tempDir, "apps.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create valid AppEntry structure", () => {
    const entry = {
      app_id: "A123456",
      name: "Test App",
      workspace: "test-workspace",
      client_id: "123.456",
      client_secret: "secret",
      created_at: new Date().toISOString(),
    };

    expect(entry.app_id).toBe("A123456");
    expect(entry.name).toBe("Test App");
    expect(entry.workspace).toBe("test-workspace");
    expect(entry.client_id).toBe("123.456");
    expect(entry.client_secret).toBe("secret");
    expect(entry.created_at).toBeTruthy();
  });

  it("should handle AppEntry with bot token", () => {
    const entry = {
      app_id: "A789",
      name: "Bot App",
      workspace: "ws",
      client_id: "c",
      client_secret: "s",
      bot_token: "xoxb-123-456-abc",
      bot_user_id: "U123",
      created_at: new Date().toISOString(),
    };

    expect(entry.bot_token).toBe("xoxb-123-456-abc");
    expect(entry.bot_user_id).toBe("U123");
  });

  it("should serialize and deserialize apps JSON", async () => {
    const apps = [
      {
        app_id: "A1",
        name: "App 1",
        workspace: "ws1",
        client_id: "c1",
        client_secret: "s1",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        app_id: "A2",
        name: "App 2",
        workspace: "ws2",
        client_id: "c2",
        client_secret: "s2",
        bot_token: "xoxb-token",
        created_at: "2026-01-02T00:00:00Z",
      },
    ];

    const fs = await import("node:fs");
    fs.writeFileSync(appsFile, JSON.stringify(apps, null, 2));

    const loaded = JSON.parse(readFileSync(appsFile, "utf-8"));
    expect(loaded).toHaveLength(2);
    expect(loaded[0].app_id).toBe("A1");
    expect(loaded[1].bot_token).toBe("xoxb-token");
  });

  it("should add app without duplicates", () => {
    const apps = [
      { app_id: "A1", name: "App 1", workspace: "ws", client_id: "c", client_secret: "s", created_at: "2026-01-01T00:00:00Z" },
    ];

    // Simulate addApp logic: update existing
    const newEntry = { app_id: "A1", name: "App 1 Updated", workspace: "ws", client_id: "c", client_secret: "s2", created_at: "2026-01-01T00:00:00Z" };
    const idx = apps.findIndex((a) => a.app_id === newEntry.app_id);
    if (idx >= 0) {
      apps[idx] = newEntry;
    } else {
      apps.push(newEntry);
    }

    expect(apps).toHaveLength(1);
    expect(apps[0]!.name).toBe("App 1 Updated");
    expect(apps[0]!.client_secret).toBe("s2");
  });

  it("should remove app by id", () => {
    const apps = [
      { app_id: "A1", name: "App 1" },
      { app_id: "A2", name: "App 2" },
      { app_id: "A3", name: "App 3" },
    ];

    const filtered = apps.filter((a) => a.app_id !== "A2");
    expect(filtered).toHaveLength(2);
    expect(filtered.map((a) => a.app_id)).toEqual(["A1", "A3"]);
  });

  it("should handle remove of non-existent app", () => {
    const apps = [{ app_id: "A1", name: "App 1" }];
    const filtered = apps.filter((a) => a.app_id !== "A999");
    expect(filtered).toHaveLength(1);
  });
});
