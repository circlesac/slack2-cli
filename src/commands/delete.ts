import { defineCommand } from "citty";
import { getApp, removeApp } from "../lib/config.ts";
import { getWorkspaceToken } from "../lib/credentials.ts";
import { slackApi } from "../lib/slack-api.ts";

export const deleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete a Slack app via Manifest API",
  },
  args: {
    "app-id": {
      type: "positional",
      description: "App ID to delete",
      required: true,
    },
  },
  async run({ args }) {
    const appId = args["app-id"];
    const app = getApp(appId);
    if (!app) {
      throw new Error(`App ${appId} not found in local config.`);
    }

    const userToken = await getWorkspaceToken(app.workspace);
    await slackApi("apps.manifest.delete", userToken, { app_id: appId });
    removeApp(appId);

    console.log(`Deleted app: ${app.name} (${appId})`);
  },
});
