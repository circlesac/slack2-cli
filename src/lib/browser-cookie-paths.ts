import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function findCookieDbs(userDataDir: string): string[] {
  if (!existsSync(userDataDir)) return [];
  const dbs: string[] = [];
  for (const rel of [["Cookies"], ["Network", "Cookies"]]) {
    const path = join(userDataDir, ...rel);
    if (existsSync(path)) {
      dbs.push(path);
      break;
    }
  }
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
