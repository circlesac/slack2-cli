/**
 * Local app registry at $XDG_CACHE_HOME/slack2/apps.json (default ~/.cache/slack2).
 * Holds created-app metadata (app_id, client_id, client_secret, bot_token). It's a
 * cache: fully re-fetchable from api.slack.com, so it lives under cache, not config.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { APPS_FILE, CACHE_DIR } from "./paths.ts";

export interface AppEntry {
  app_id: string;
  name: string;
  workspace: string;
  client_id: string;
  client_secret: string;
  signing_secret?: string;
  bot_token?: string;
  bot_user_id?: string;
  user_token?: string;
  authed_user_id?: string;
  created_at: string;
}

function ensureDir() {
  mkdirSync(CACHE_DIR, { recursive: true });
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
