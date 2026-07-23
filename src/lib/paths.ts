/**
 * XDG Base Directory resolution for slack2's on-disk files.
 *
 * Files are split by what they actually are, not lumped into one config dir:
 *   - apps.json  → CACHE  (a local registry that's fully re-fetchable from
 *                  api.slack.com — losing it just means re-importing)
 *   - cookies.json → STATE (the Slack `d` session cookie: sensitive + persistent,
 *                  re-captured via `slack2 login` but not auto-regenerated)
 *   - CONFIG_DIR is reserved for genuine user settings (none yet).
 *
 * Pre-XDG builds put everything under ~/.config/slack2, which — when that dir is
 * dotfiles-tracked — leaked the cookie and app secrets into git. `migrateLegacyPaths`
 * relocates them out of there once.
 */
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, renameSync, copyFileSync, rmSync, rmdirSync } from "node:fs";

/** Honor an XDG env var when it's an absolute path; else fall back under $HOME. */
function xdgDir(envVar: string, ...fallback: string[]): string {
  const v = process.env[envVar]?.trim();
  return v && v.startsWith("/") ? v : join(homedir(), ...fallback);
}

export const CONFIG_DIR = join(xdgDir("XDG_CONFIG_HOME", ".config"), "slack2");
export const CACHE_DIR = join(xdgDir("XDG_CACHE_HOME", ".cache"), "slack2");
export const STATE_DIR = join(xdgDir("XDG_STATE_HOME", ".local", "state"), "slack2");

export const APPS_FILE = join(CACHE_DIR, "apps.json");
export const COOKIES_FILE = join(STATE_DIR, "cookies.json");
// Update-check timestamp — a throwaway cache.
export const UPDATE_CHECK_FILE = join(CACHE_DIR, "update-check.json");

const LEGACY_DIR = join(homedir(), ".config", "slack2");

function migrateFile(legacy: string, dest: string): void {
  if (existsSync(dest) || !existsSync(legacy)) return;
  mkdirSync(dirname(dest), { recursive: true });
  try {
    renameSync(legacy, dest);
  } catch {
    // Different filesystem (EXDEV) — copy instead; legacy is left for manual cleanup.
    copyFileSync(legacy, dest);
  }
  console.error(`[slack2] migrated ${legacy} → ${dest}`);
}

/** One-time relocation of pre-XDG files. Idempotent — safe to call every startup. */
export function migrateLegacyPaths(): void {
  migrateFile(join(LEGACY_DIR, "apps.json"), APPS_FILE);
  migrateFile(join(LEGACY_DIR, "cookies.json"), COOKIES_FILE);
  // The old update-check cache is disposable — drop it (new one regenerates under
  // CACHE_DIR), then remove the now-empty legacy ~/.config/slack2 tree.
  try {
    rmSync(join(LEGACY_DIR, "cache"), { recursive: true, force: true });
    rmdirSync(LEGACY_DIR); // only succeeds if now empty; throws (caught) otherwise
  } catch {
    // Legacy dir still has other files — leave it be.
  }
}
