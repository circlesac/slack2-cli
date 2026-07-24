import { defineCommand } from "citty";
import { getApp } from "../lib/config.ts";
import { loadCookieHeader } from "../lib/app-scraper.ts";
import { setDistribution } from "../lib/distribution.ts";

export const distributeCommand = defineCommand({
  meta: {
    name: "distribute",
    description:
      "Enable Public Distribution for an app (required to install it into other workspaces); --off to disable",
  },
  args: {
    "app-id": {
      type: "positional",
      description: "App ID to distribute",
      required: true,
    },
    off: {
      type: "boolean",
      description: "Disable Public Distribution instead of enabling it",
    },
  },
  async run({ args }) {
    const appId = args["app-id"];
    const app = getApp(appId);
    if (!app) {
      throw new Error(`App ${appId} not found in local config.`);
    }

    const enabled = !args.off;
    const { changed } = await setDistribution(app.workspace, appId, enabled, loadCookieHeader());

    if (enabled) {
      console.log(
        changed
          ? `Public Distribution enabled: ${app.name} (${appId})`
          : `Already publicly distributed: ${app.name} (${appId})`,
      );
      if (changed) {
        console.log(`  Now installable into other workspaces — run: slack2 install ${appId}`);
      }
    } else {
      console.log(
        changed
          ? `Public Distribution disabled: ${app.name} (${appId})`
          : `Already not distributed: ${app.name} (${appId})`,
      );
    }
  },
});
