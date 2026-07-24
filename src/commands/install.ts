import { defineCommand } from "citty";
import { getApp, addApp } from "../lib/config.ts";
import { redirectUri, waitForOAuthCode, exchangeCodeForToken } from "../lib/oauth.ts";
import { slackApi } from "../lib/slack-api.ts";
import { getWorkspaceToken } from "../lib/credentials.ts";

interface Manifest {
  oauth_config?: {
    redirect_urls?: string[];
    scopes?: { bot?: string[]; user?: string[] };
  };
  [key: string]: unknown;
}

async function exportManifest(token: string, appId: string): Promise<Manifest> {
  const res = await slackApi("apps.manifest.export", token, { app_id: appId });
  return (res.manifest ?? {}) as Manifest;
}

async function setRedirectUrls(
  token: string,
  appId: string,
  manifest: Manifest,
  redirectUrls: string[],
): Promise<void> {
  const next: Manifest = {
    ...manifest,
    oauth_config: { ...manifest.oauth_config, redirect_urls: redirectUrls },
  };
  await slackApi("apps.manifest.update", token, { app_id: appId, manifest: next });
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

    const token = await getWorkspaceToken(app.workspace);
    const manifest = await exportManifest(token, appId);

    const scopes = {
      bot: manifest.oauth_config?.scopes?.bot ?? [],
      user: manifest.oauth_config?.scopes?.user ?? [],
    };
    console.log(`Scopes: ${scopes.bot.join(", ")}`);

    // slack2's OAuth dance redirects to a localhost callback. A publicly
    // distributed app keeps only https redirect URLs (Slack's distribution
    // checklist rejects http/localhost), so authorize would fail on the
    // localhost redirect_uri. Add it just for the install, then restore the
    // original set in `finally` — so the app stays distribution-clean whether
    // the install succeeds, fails, or is aborted. No-op when localhost is
    // already configured (non-distributed apps behave exactly as before).
    const redirect = redirectUri();
    const originalRedirects = manifest.oauth_config?.redirect_urls ?? [];
    const needsTempRedirect = !originalRedirects.includes(redirect);
    if (needsTempRedirect) {
      await setRedirectUrls(token, appId, manifest, [...originalRedirects, redirect]);
      console.log(`Temporarily added ${redirect} to redirect URLs for install.`);
    }

    try {
      let authorizeUrl =
        `https://slack.com/oauth/v2/authorize` +
        `?client_id=${app.client_id}` +
        `&scope=${encodeURIComponent(scopes.bot.join(","))}` +
        `&redirect_uri=${encodeURIComponent(redirect)}`;

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
        redirect,
      );

      app.bot_token = accessToken;
      app.bot_user_id = botUserId;
      addApp(app);

      console.log(`\nBot token: ${accessToken.slice(0, 20)}...`);
      console.log(`Bot user:  ${botUserId}`);
      console.log(`\nStored in ~/.config/slack2/apps.json`);
    } finally {
      if (needsTempRedirect) {
        await setRedirectUrls(token, appId, manifest, originalRedirects);
        console.log(`Restored original redirect URLs.`);
      }
    }
  },
});
