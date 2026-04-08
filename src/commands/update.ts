import { defineCommand } from "citty";
import { readFileSync } from "node:fs";
import { getApp } from "../lib/config.ts";
import { getWorkspaceToken } from "../lib/credentials.ts";
import { slackApi } from "../lib/slack-api.ts";

export const updateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update a Slack app's manifest",
  },
  args: {
    "app-id": {
      type: "positional",
      description: "App ID to update",
      required: true,
    },
    manifest: {
      type: "string",
      alias: "m",
      description: "Path to manifest JSON file",
      required: true,
    },
  },
  async run({ args }) {
    const appId = args["app-id"];
    const app = getApp(appId);
    if (!app) {
      throw new Error(`App ${appId} not found in local config.`);
    }

    const manifest = JSON.parse(readFileSync(args.manifest, "utf-8"));
    const userToken = await getWorkspaceToken(app.workspace);

    await slackApi("apps.manifest.update", userToken, {
      app_id: appId,
      manifest,
    });

    console.log(`Updated manifest for: ${app.name} (${appId})`);
  },
});
