/**
 * Local config storage at ~/.config/slack2/apps.json
 * Stores created app metadata (app_id, client_id, client_secret, bot_token).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface AppEntry {
  app_id: string;
  name: string;
  workspace: string;
  client_id: string;
  client_secret: string;
  bot_token?: string;
  bot_user_id?: string;
  created_at: string;
}

const CONFIG_DIR = join(homedir(), ".config", "slack2");
const APPS_FILE = join(CONFIG_DIR, "apps.json");

function ensureDir() {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadApps(): AppEntry[] {
  if (!existsSync(APPS_FILE)) return [];
  return JSON.parse(readFileSync(APPS_FILE, "utf-8")) as AppEntry[];
}

export function saveApps(apps: AppEntry[]) {
  ensureDir();
  writeFileSync(APPS_FILE, JSON.stringify(apps, null, 2) + "\n");
}

export function addApp(entry: AppEntry) {
  const apps = loadApps();
  const idx = apps.findIndex((a) => a.app_id === entry.app_id);
  if (idx >= 0) {
    apps[idx] = entry;
  } else {
    apps.push(entry);
  }
  saveApps(apps);
}

export function getApp(appId: string): AppEntry | undefined {
  return loadApps().find((a) => a.app_id === appId);
}

export function removeApp(appId: string): boolean {
  const apps = loadApps();
  const filtered = apps.filter((a) => a.app_id !== appId);
  if (filtered.length === apps.length) return false;
  saveApps(filtered);
  return true;
}
