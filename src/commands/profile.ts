import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getApp } from "../lib/config.ts";
import { loadCookieHeader } from "../lib/app-scraper.ts";
import { saveGeneralInfo } from "../lib/general-page.ts";

export const profileCommand = defineCommand({
  meta: {
    name: "profile",
    description: "Update a Slack app's display profile (name, description, color, icon)",
  },
  args: {
    "app-id": {
      type: "positional",
      description: "App ID to update",
      required: true,
    },
    name: {
      type: "string",
      description: "App display name",
    },
    description: {
      type: "string",
      alias: "d",
      description: "Short app description",
    },
    "long-description": {
      type: "string",
      description: "Long app description",
    },
    "background-color": {
      type: "string",
      description: "App card background color, e.g. #2C2D30",
    },
    icon: {
      type: "string",
      alias: "i",
      description: "Path to a PNG/JPEG/WebP/GIF icon image (optional)",
    },
  },
  async run({ args }) {
    const appId = args["app-id"];
    const app = getApp(appId);
    if (!app) {
      throw new Error(`App ${appId} not found in local config.`);
    }

    if (
      args.name == null &&
      args.description == null &&
      args["long-description"] == null &&
      args["background-color"] == null &&
      args.icon == null
    ) {
      throw new Error(
        "Nothing to update — pass at least one of --name, --description, --long-description, --background-color, --icon.",
      );
    }

    let iconPath: string | undefined;
    if (args.icon) {
      iconPath = resolve(args.icon);
      if (!existsSync(iconPath)) {
        throw new Error(`Image not found: ${iconPath}`);
      }
    }

    const cookieHeader = loadCookieHeader();
    const { name, iconUrl } = await saveGeneralInfo(appId, cookieHeader, {
      name: args.name,
      description: args.description,
      longDescription: args["long-description"],
      backgroundColor: args["background-color"],
      iconPath,
    });

    console.log(`Updated profile for: ${name} (${appId})`);
    if (iconUrl) {
      console.log(`  icon: ${iconUrl}`);
    }
  },
});
