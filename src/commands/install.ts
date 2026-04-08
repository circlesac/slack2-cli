import { defineCommand } from "citty";
import { getApp, addApp } from "../lib/config.ts";
import { redirectUri, waitForOAuthCode, exchangeCodeForToken } from "../lib/oauth.ts";
import { slackApi } from "../lib/slack-api.ts";
import { getWorkspaceToken } from "../lib/credentials.ts";

export const installCommand = defineCommand({
  meta: {
    name: "install",
    description: "Install a created app to the workspace (OAuth flow)",
  },
  args: {
    "app-id": {
      type: "positional",
      description: "App ID (from 'slack2 create')",
      required: true,
    },
  },
  async run({ args }) {
    const appId = args["app-id"];
    const app = getApp(appId);
    if (!app) {
      throw new Error(
        `App ${appId} not found in local config. Run "slack2 list" to see known apps.`,
      );
    }

    // Get the OAuth authorize URL from the manifest create response or build it
    const authorizeUrl =
      `https://slack.com/oauth/v2/authorize` +
      `?client_id=${app.client_id}` +
      `&scope=${encodeURIComponent("chat:write,chat:write.public,channels:history,channels:read")}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}`;

    console.log(`Installing app: ${app.name} (${appId})`);
    const code = await waitForOAuthCode(authorizeUrl);

    console.log("Exchanging code for bot token...");
    const { accessToken, botUserId } = await exchangeCodeForToken(
      code,
      app.client_id,
      app.client_secret,
      redirectUri(),
    );

    app.bot_token = accessToken;
    app.bot_user_id = botUserId;
    addApp(app);

    console.log(`\nBot token: ${accessToken.slice(0, 20)}...`);
    console.log(`Bot user:  ${botUserId}`);
    console.log(`\nStored in ~/.config/slack2/apps.json`);
  },
});
