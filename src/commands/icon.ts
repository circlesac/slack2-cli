import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getApp } from "../lib/config.ts";
import { loadCookieHeader } from "../lib/app-scraper.ts";
import { saveGeneralInfo } from "../lib/general-page.ts";

export const iconCommand = defineCommand({
  meta: {
    name: "icon",
    description: "Upload a Slack app icon from an image file",
  },
  args: {
    "app-id": {
      type: "positional",
      description: "App ID to update",
      required: true,
    },
    image: {
      type: "string",
      alias: "i",
      description: "Path to a PNG/JPEG/WebP/GIF icon image",
      required: true,
    },
    name: {
      type: "string",
      description: "App display name to keep/update while saving display info",
    },
    description: {
      type: "string",
      alias: "d",
      description: "Short app description to keep/update while saving display info",
    },
    "background-color": {
      type: "string",
      description: "App card background color, e.g. #2C2D30",
    },
    "long-description": {
      type: "string",
      description: "Long app description to keep/update while saving display info",
    },
  },
  async run({ args }) {
    const appId = args["app-id"];
    const app = getApp(appId);
    if (!app) {
      throw new Error(`App ${appId} not found in local config.`);
    }

    const imagePath = resolve(args.image);
    if (!existsSync(imagePath)) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    const cookieHeader = loadCookieHeader();
    const { iconUrl } = await saveGeneralInfo(appId, cookieHeader, {
      name: args.name,
      description: args.description,
      backgroundColor: args["background-color"],
      longDescription: args["long-description"],
      iconPath: imagePath,
    });

    console.log(`Uploaded icon for: ${app.name} (${appId})`);
    if (iconUrl) {
      console.log(`  icon: ${iconUrl}`);
    }
  },
});
