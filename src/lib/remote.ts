/**
 * Fetch and parse the app list from api.slack.com/apps using stored cookies.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface RemoteApp {
  name: string;
  workspace: string;
  appId: string;
  distribution: string;
}

const COOKIES_FILE = join(homedir(), ".config", "slack2", "cookies.json");

export function parseAppsHtml(html: string): RemoteApp[] {
  const apps: RemoteApp[] = [];

  const rowRegex =
    /data-app-name="([^"]*)"[^>]*data-team-name="([^"]*)"[\s\S]*?href="\/apps\/(A[A-Z0-9]+)"[\s\S]*?<span class="bold">([^<]*)<\/span>[\s\S]*?<\/tr>/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const [, , teamName, appId, appName] = match;
    apps.push({
      name: appName ?? "",
      workspace: teamName ?? "",
      appId: appId ?? "",
      distribution: match[0].includes("Publicly Distributed")
        ? "Publicly Distributed"
        : "Not distributed",
    });
  }

  return apps;
}

export async function fetchRemoteApps(): Promise<RemoteApp[]> {
  if (!existsSync(COOKIES_FILE)) {
    throw new Error(
      'No saved session. Run "slack2 login" first.',
    );
  }

  const cookies = JSON.parse(readFileSync(COOKIES_FILE, "utf-8")) as Array<{
    name: string;
    value: string;
  }>;

  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const res = await fetch("https://api.slack.com/apps", {
    headers: {
      Cookie: cookieHeader,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (res.status !== 200) {
    throw new Error(`Failed to fetch apps page: HTTP ${res.status}`);
  }

  const html = await res.text();

  if (html.includes("You'll need to sign in")) {
    throw new Error(
      'Session expired. Run "slack2 login" to re-authenticate.',
    );
  }

  return parseAppsHtml(html);
}
