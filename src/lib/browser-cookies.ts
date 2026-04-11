/**
 * Read the Slack `d` cookie from any Chromium-based browser's cookie database.
 * macOS only — uses Keychain to decrypt the cookie value.
 *
 * Supported: Chrome, Arc, Edge, Brave, Chromium, Comet
 * Also falls back to Slack desktop app.
 */

import { Database } from "bun:sqlite";
import { existsSync, copyFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";

interface BrowserConfig {
  name: string;
  keychainService: string;
  userDataDir: string;
}

const BROWSERS: BrowserConfig[] = [
  {
    name: "Chrome",
    keychainService: "Chrome Safe Storage",
    userDataDir: join(homedir(), "Library", "Application Support", "Google", "Chrome"),
  },
  {
    name: "Arc",
    keychainService: "Arc Safe Storage",
    userDataDir: join(homedir(), "Library", "Application Support", "Arc", "User Data"),
  },
  {
    name: "Edge",
    keychainService: "Microsoft Edge Safe Storage",
    userDataDir: join(homedir(), "Library", "Application Support", "Microsoft Edge"),
  },
  {
    name: "Brave",
    keychainService: "Brave Safe Storage",
    userDataDir: join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
  },
  {
    name: "Chromium",
    keychainService: "Chromium Safe Storage",
    userDataDir: join(homedir(), "Library", "Application Support", "Chromium"),
  },
  {
    name: "Comet",
    keychainService: "Comet Safe Storage",
    userDataDir: join(homedir(), "Library", "Application Support", "Comet"),
  },
];

function findCookieDbs(userDataDir: string): string[] {
  if (!existsSync(userDataDir)) return [];
  const dbs: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(userDataDir);
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry !== "Default" && !entry.startsWith("Profile ")) continue;
    const dir = join(userDataDir, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const rel of [["Cookies"], ["Network", "Cookies"]]) {
      const path = join(dir, ...rel);
      if (existsSync(path)) {
        dbs.push(path);
        break;
      }
    }
  }
  return dbs;
}

function getKeychainKey(browser: BrowserConfig): Buffer {
  const output = execSync(
    `security find-generic-password -s "${browser.keychainService}" -g 2>&1`,
    { encoding: "utf-8" },
  );
  const match = output.match(/password:\s*"([^"]+)"/);
  if (!match?.[1]) {
    throw new Error(`Could not parse ${browser.keychainService} keychain password`);
  }
  return pbkdf2Sync(match[1], "saltysalt", 1003, 16, "sha1");
}

function decryptCookie(encrypted: Buffer, key: Buffer): string {
  if (!encrypted || encrypted.length === 0) return "";

  const prefix = encrypted.subarray(0, 3).toString("utf-8");
  if (prefix !== "v10") return encrypted.toString("utf-8");

  const payload = encrypted.subarray(3);
  const iv = Buffer.from(" ".repeat(16), "utf-8");
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);

  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);

  // Remove PKCS7 padding
  const padByte = decrypted[decrypted.length - 1]!;
  const unpadded =
    padByte > 0 && padByte <= 16
      ? decrypted.subarray(0, decrypted.length - padByte)
      : decrypted;

  return unpadded.toString("utf-8");
}

function findSlackCookieInDb(cookiesPath: string, browser: BrowserConfig): string | null {
  const tmpDb = join(tmpdir(), `slack2-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  copyFileSync(cookiesPath, tmpDb);
  try {
    const db = new Database(tmpDb, { readonly: true });
    const row = db
      .query<{ encrypted_value: Buffer }, []>(
        "SELECT encrypted_value FROM cookies WHERE name = 'd' AND host_key = '.slack.com' LIMIT 1",
      )
      .get();
    db.close();

    if (!row) return null;

    const key = getKeychainKey(browser);
    const value = decryptCookie(Buffer.from(row.encrypted_value), key);

    if (!value.includes("xoxd-")) return null;

    const match = value.match(/xoxd-[A-Za-z0-9%_.~+-]+/);
    return match ? match[0] : null;
  } catch {
    return null;
  } finally {
    try { unlinkSync(tmpDb); } catch {}
  }
}

/**
 * Reads the Slack `d` cookie from any available Chromium browser.
 * Tries each browser in order until one has the cookie.
 */
export async function readSlackCookie(): Promise<{
  value: string;
  source: string;
} | null> {
  if (process.platform !== "darwin") return null;

  for (const browser of BROWSERS) {
    const dbs = findCookieDbs(browser.userDataDir);
    for (const db of dbs) {
      const value = findSlackCookieInDb(db, browser);
      if (value) {
        const profile = db.split("/").slice(-3, -1).join("/").includes("Network")
          ? db.split("/").slice(-3, -2)[0]
          : db.split("/").slice(-2, -1)[0];
        return { value, source: `${browser.name} (${profile})` };
      }
    }
  }

  return null;
}
