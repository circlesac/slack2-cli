import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCookieDbs } from "../src/lib/browser-cookie-paths.ts";

describe("browser cookie discovery", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("finds a root cookie database used by the Slack desktop app", () => {
    const directory = mkdtempSync(join(tmpdir(), "slack2-cookies-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, "Cookies"), "");

    expect(findCookieDbs(directory)).toEqual([join(directory, "Cookies")]);
  });

  it("continues to find Chromium profile cookie databases", () => {
    const directory = mkdtempSync(join(tmpdir(), "slack2-cookies-"));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, "Default", "Network"), { recursive: true });
    mkdirSync(join(directory, "Profile 1"), { recursive: true });
    writeFileSync(join(directory, "Default", "Network", "Cookies"), "");
    writeFileSync(join(directory, "Profile 1", "Cookies"), "");

    expect(findCookieDbs(directory)).toEqual([
      join(directory, "Default", "Network", "Cookies"),
      join(directory, "Profile 1", "Cookies"),
    ]);
  });
});
