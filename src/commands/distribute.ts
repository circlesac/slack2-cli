import { defineCommand } from "citty";
import { getApp } from "../lib/config.ts";
import { loadCookieHeader } from "../lib/app-scraper.ts";
import { activateDistribution } from "../lib/distribute-page.ts";

export const distributeCommand = defineCommand({
  meta: {
    name: "distribute",
    description:
      "Activate Public Distribution for an app (required to install it into other workspaces)",
  },
  args: {
    "app-id": {
      type: "positional",
      description: "App ID to distribute",
      required: true,
    },
  },
  async run({ args }) {
    const appId = args["app-id"];
    const app = getApp(appId);
    if (!app) {
      throw new Error(`App ${appId} not found in local config.`);
    }

    const cookieHeader = loadCookieHeader();
    const { alreadyDistributed } = await activateDistribution(appId, cookieHeader);

    if (alreadyDistributed) {
      console.log(`Already publicly distributed: ${appId}`);
    } else {
      console.log(`Activated Public Distribution: ${appId}`);
      console.log(`  Now installable into other workspaces — run: slack2 install ${appId}`);
    }
  },
});
