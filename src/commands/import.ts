import { defineCommand } from "citty";
import { addApp, getApp, type AppEntry } from "../lib/config.ts";
import { scrapeApp } from "../lib/app-scraper.ts";
import { listWorkspaces } from "../lib/credentials.ts";
import { fetchRemoteApps } from "../lib/remote.ts";

export const importCommand = defineCommand({
  meta: {
    name: "import",
    description: "Import an externally-created Slack app into local config (scrapes credentials)",
  },
  args: {
    "app-id": {
      type: "positional",
      description: "App ID (e.g. A0123456789)",
      required: true,
    },
    workspace: {
      type: "string",
      alias: "w",
      description: "Workspace domain (overrides auto-detect)",
    },
    force: {
      type: "boolean",
      alias: "f",
      description: "Overwrite existing entry",
      default: false,
    },
  },
  async run({ args }) {
    const appId = args["app-id"];
    const existing = getApp(appId);
    if (existing && !args.force) {
      throw new Error(
        `App ${appId} already in local config (${existing.name}). Use --force to overwrite.`,
      );
    }

    console.log(`Scraping credentials for ${appId}...`);
    const scraped = await scrapeApp(appId);

    let workspace = args.workspace;
    if (!workspace) {
      const workspaces = await listWorkspaces();
      const match = workspaces.find((w) => w.team_id === scraped.team_id);
      if (match) {
        workspace = match.domain;
      } else if (workspaces.length === 1 && workspaces[0]) {
        workspace = workspaces[0].domain;
      }
    }
    if (!workspace) {
      throw new Error(
        `Could not determine workspace for ${appId} (team_id=${scraped.team_id}). Pass --workspace <domain>.`,
      );
    }

    // If per-app page didn't yield a human name, fall back to scraping the apps list
    let name = scraped.name;
    if (name === appId) {
      try {
        const remote = await fetchRemoteApps();
        const match = remote.find((a) => a.appId === appId);
        if (match?.name) name = match.name;
      } catch {
        // best effort
      }
    }

    const entry: AppEntry = {
      app_id: scraped.app_id,
      name,
      workspace,
      client_id: scraped.client_id,
      client_secret: scraped.client_secret,
      signing_secret: scraped.signing_secret,
      created_at: existing?.created_at ?? new Date().toISOString(),
      ...(existing?.bot_token ? { bot_token: existing.bot_token } : {}),
      ...(existing?.bot_user_id ? { bot_user_id: existing.bot_user_id } : {}),
    };
    addApp(entry);

    console.log(`Imported: ${entry.name} (${entry.app_id})`);
    console.log(`  workspace:      ${entry.workspace}`);
    console.log(`  client_id:      ${entry.client_id}`);
    console.log(`  client_secret:  ${entry.client_secret.slice(0, 6)}...`);
    console.log(`  signing_secret: ${entry.signing_secret!.slice(0, 6)}...`);
  },
});
