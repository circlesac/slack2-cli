import { defineCommand } from "citty";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readSlackCookie } from "../lib/browser-cookies.ts";

const CONFIG_DIR = join(homedir(), ".config", "slack2");
const COOKIES_FILE = join(CONFIG_DIR, "cookies.json");

export const loginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Save Slack session from browser cookies (auto-reads from Chrome/Slack app)",
  },
  args: {
    cookie: {
      type: "string",
      description: "Manually provide the d cookie value (xoxd-...)",
    },
  },
  async run({ args }) {
    let cookieValue: string;
    let source: string;

    if (args.cookie) {
      if (!args.cookie.startsWith("xoxd-")) {
        throw new Error("Cookie must start with xoxd-");
      }
      cookieValue = args.cookie;
      source = "manual";
    } else {
      console.log("Reading Slack cookie from browser...");
      const result = await readSlackCookie();
      if (!result) {
        throw new Error(
          "Could not find Slack session cookie.\n" +
          "  Make sure you are logged in to api.slack.com in Chrome,\n" +
          "  or provide it manually: slack2 login --cookie xoxd-...",
        );
      }
      cookieValue = result.value;
      source = result.source;
      console.log(`Found cookie from ${source}: ${cookieValue.slice(0, 25)}...`);
    }

    // Save as cookie array (compatible with fetch)
    const cookies = [
      { name: "d", value: cookieValue, domain: ".slack.com" },
    ];

    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));

    console.log(`Session saved to ${COOKIES_FILE}`);
  },
});
