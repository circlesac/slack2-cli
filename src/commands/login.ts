import { defineCommand } from "citty";
import { writeFileSync, mkdirSync } from "node:fs";
import { readSlackCookie } from "../lib/browser-cookies.ts";
import { COOKIES_FILE, STATE_DIR } from "../lib/paths.ts";
import {
  getWorkspaceClientToken,
  normalizeWorkspaceDomain,
} from "../lib/workspace-client.ts";

export const loginCommand = defineCommand({
  meta: {
    name: "login",
    description:
      "Save a browser session for app discovery and workspace administration",
  },
  args: {
    cookie: {
      type: "string",
      description: "Manually provide the d cookie value (xoxd-...)",
    },
    workspace: {
      type: "string",
      alias: "w",
      description: "Select a browser session that can open this workspace",
    },
  },
  async run({ args }) {
    let cookieValue: string;
    let source: string;
    const workspace = args.workspace
      ? normalizeWorkspaceDomain(args.workspace)
      : undefined;

    if (args.cookie) {
      if (!args.cookie.startsWith("xoxd-")) {
        throw new Error("Cookie must start with xoxd-");
      }
      if (workspace) {
        try {
          await getWorkspaceClientToken(workspace, `d=${args.cookie}`);
        } catch {
          throw new Error(`The provided cookie cannot open ${workspace}.slack.com`);
        }
      }
      cookieValue = args.cookie;
      source = "manual";
    } else {
      console.log("Reading Slack cookie from browser or desktop app...");
      const result = await readSlackCookie(workspace
        ? async (value) => {
            try {
              await getWorkspaceClientToken(workspace, `d=${value}`);
              return true;
            } catch {
              return false;
            }
          }
        : undefined);
      if (!result) {
        throw new Error(
          `Could not find a Slack session cookie${workspace ? ` for ${workspace}` : ""}.\n` +
          "  Make sure you are logged in to Slack in a Chromium browser or the desktop app,\n" +
          "  or provide it manually: slack2 login --cookie xoxd-...",
        );
      }
      cookieValue = result.value;
      source = result.source;
      console.log(`Found Slack session from ${source}.`);
    }

    // Save as cookie array (compatible with fetch)
    const cookies = [
      { name: "d", value: cookieValue, domain: ".slack.com" },
    ];

    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));

    console.log(`Session saved to ${COOKIES_FILE}`);
  },
});
