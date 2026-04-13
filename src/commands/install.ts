import { defineCommand } from "citty";
import { getApp, addApp } from "../lib/config.ts";
import { redirectUri, waitForOAuthCode, exchangeCodeForToken } from "../lib/oauth.ts";
import { slackApi } from "../lib/slack-api.ts";
import { getWorkspaceToken } from "../lib/credentials.ts";

async function getManifestScopes(workspace: string, appId: string): Promise<{ bot: string[]; user: string[] }> {
  const token = await getWorkspaceToken(workspace);
  const res = await slackApi("apps.manifest.export", token, { app_id: appId });
  const manifest = res.manifest as { oauth_config?: { scopes?: { bot?: string[]; user?: string[] } } };
  return {
    bot: manifest?.oauth_config?.scopes?.bot ?? [],
    user: manifest?.oauth_config?.scopes?.user ?? [],
  };
}

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

    // Fetch scopes from the app's manifest
    const scopes = await getManifestScopes(app.workspace, appId);
    console.log(`Scopes: ${scopes.bot.join(", ")}`);

    let authorizeUrl =
      `https://slack.com/oauth/v2/authorize` +
      `?client_id=${app.client_id}` +
      `&scope=${encodeURIComponent(scopes.bot.join(","))}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}`;

    if (scopes.user.length > 0) {
      authorizeUrl += `&user_scope=${encodeURIComponent(scopes.user.join(","))}`;
    }

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
