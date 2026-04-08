/**
 * Reads Slack CLI credentials from ~/.slack/credentials.json.
 * The official `slack` CLI stores workspace tokens here.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface SlackCredential {
  token: string;
  team_id?: string;
  team_domain: string;
  user_id?: string;
  exp?: number;
  refresh_token?: string;
}

const CRED_PATH = join(homedir(), ".slack", "credentials.json");

export async function getWorkspaceToken(workspace: string): Promise<string> {
  if (!existsSync(CRED_PATH)) {
    throw new Error(
      `${CRED_PATH} not found. Install the Slack CLI and run "slack login" first.`,
    );
  }

  const raw = await readFile(CRED_PATH, "utf-8");
  const creds = JSON.parse(raw) as Record<string, SlackCredential>;

  for (const cred of Object.values(creds)) {
    if (cred.team_domain === workspace) {
      const now = Math.floor(Date.now() / 1000);
      if (cred.exp && cred.exp < now && cred.refresh_token) {
        const res = await fetch("https://slack.com/api/tooling.tokens.rotate", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ refresh_token: cred.refresh_token }),
        });
        const data = (await res.json()) as { ok: boolean; token?: string };
        if (!data.ok || !data.token) throw new Error("Token rotation failed");
        return data.token;
      }
      return cred.token;
    }
  }

  const available = Object.values(creds)
    .map((c) => c.team_domain)
    .join(", ");
  throw new Error(
    `Workspace "${workspace}" not found in credentials. Available: ${available || "none"}`,
  );
}

export async function listWorkspaces(): Promise<
  Array<{ domain: string; team_id?: string; user_id?: string }>
> {
  if (!existsSync(CRED_PATH)) return [];

  const raw = await readFile(CRED_PATH, "utf-8");
  const creds = JSON.parse(raw) as Record<string, SlackCredential>;

  return Object.values(creds).map((c) => ({
    domain: c.team_domain,
    team_id: c.team_id,
    user_id: c.user_id,
  }));
}
