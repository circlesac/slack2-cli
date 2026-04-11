/**
 * Scrape credentials (client_id, client_secret, signing_secret) and metadata
 * from api.slack.com/apps/<app_id>/general using the stored session cookie.
 *
 * The Slack app admin UI stores secret values directly in `data-password`
 * attributes on the masked input fields; the "Show" button just copies the
 * attribute into the input value via JS.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const COOKIES_FILE = join(homedir(), ".config", "slack2", "cookies.json");

export interface ScrapedApp {
  app_id: string;
  name: string;
  team_id: string;
  client_id: string;
  client_secret: string;
  signing_secret: string;
}

function loadCookieHeader(): string {
  if (!existsSync(COOKIES_FILE)) {
    throw new Error('No saved session. Run "slack2 login" first.');
  }
  const cookies = JSON.parse(readFileSync(COOKIES_FILE, "utf-8")) as Array<{
    name: string;
    value: string;
  }>;
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function extractDataPassword(html: string, qa: "client_secret" | "signing_secret"): string | null {
  // Match data-password="..." followed (within the same tag) by data-qa="<qa>"
  const forward = new RegExp(`data-password="([^"]+)"[^>]*data-qa="${qa}"`);
  const reverse = new RegExp(`data-qa="${qa}"[^>]*data-password="([^"]+)"`);
  const m = html.match(forward) ?? html.match(reverse);
  return m?.[1] ?? null;
}

function extractClientId(html: string): string | null {
  // The readonly input has id="oauth_client_id_<suffix>" ... value="<team>.<app>"
  const m =
    html.match(/id="oauth_client_id_\d+"[^>]*value="([0-9]+\.[0-9]+)"/) ??
    html.match(/"client_id"\s*:\s*"([0-9]+\.[0-9]+)"/);
  return m?.[1] ?? null;
}

function extractAppName(html: string): string | null {
  // data-app-name appears in the app header breadcrumb
  const m =
    html.match(/data-app-name="([^"]+)"/) ??
    html.match(/"name"\s*:\s*"([^"]+)"\s*,\s*"is_bot"/);
  return m?.[1]?.trim() ?? null;
}

function extractTeamId(html: string): string | null {
  // The boot_data or automount props embed the team id as "encoded_id":"T..."
  const m =
    html.match(/"encoded_id"\s*:\s*"(T[A-Z0-9]+)"/) ??
    html.match(/\bT[A-Z0-9]{8,}\b/);
  return m?.[1] ?? (m ? m[0] : null);
}

export async function scrapeApp(appId: string): Promise<ScrapedApp> {
  if (!/^A[A-Z0-9]{8,}$/.test(appId)) {
    throw new Error(`Invalid app id: ${appId}`);
  }

  const cookieHeader = loadCookieHeader();
  const res = await fetch(`https://api.slack.com/apps/${appId}/general`, {
    headers: {
      Cookie: cookieHeader,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (res.status !== 200) {
    throw new Error(`Failed to fetch app page: HTTP ${res.status}`);
  }

  const html = await res.text();
  if (html.includes("You'll need to sign in")) {
    throw new Error('Session expired. Run "slack2 login" to re-authenticate.');
  }

  const client_id = extractClientId(html);
  const client_secret = extractDataPassword(html, "client_secret");
  const signing_secret = extractDataPassword(html, "signing_secret");
  const name = extractAppName(html) ?? appId;
  const team_id = extractTeamId(html) ?? "";

  if (!client_id || !client_secret || !signing_secret) {
    throw new Error(
      `Failed to scrape credentials for ${appId}. ` +
        `Got client_id=${!!client_id}, client_secret=${!!client_secret}, signing_secret=${!!signing_secret}.`,
    );
  }

  return { app_id: appId, name, team_id, client_id, client_secret, signing_secret };
}
