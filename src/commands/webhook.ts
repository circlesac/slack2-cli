import { defineCommand } from "citty";
import { scrapeWebhooks } from "../lib/app-scraper.ts";
import { getApp } from "../lib/config.ts";
import { redirectUri, waitForOAuthCode, exchangeCodeForWebhook } from "../lib/oauth.ts";

const appIdArg = {
  "app-id": {
    type: "positional" as const,
    description: "App ID (e.g. A0123456789)",
    required: true,
  },
};

export const webhookListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List an app's incoming webhooks (channel + URL)",
  },
  args: {
    ...appIdArg,
    json: { type: "boolean" as const, description: "Output as JSON" },
  },
  async run({ args }) {
    const webhooks = await scrapeWebhooks(args["app-id"]);
    if (args.json) {
      console.log(JSON.stringify(webhooks, null, 2));
      return;
    }
    if (webhooks.length === 0) {
      console.log("(no incoming webhooks)");
      return;
    }
    const w = Math.max(...webhooks.map((h) => h.channel.length), 7);
    console.log(`${"CHANNEL".padEnd(w)}  URL`);
    for (const h of webhooks) console.log(`${`#${h.channel}`.padEnd(w)}  ${h.url}`);
  },
});

export const webhookGetCommand = defineCommand({
  meta: {
    name: "get",
    description: "Print the webhook URL for a channel (for scripting/piping)",
  },
  args: {
    ...appIdArg,
    channel: {
      type: "string" as const,
      description: "Channel name (without #)",
      required: true,
    },
  },
  async run({ args }) {
    const want = args.channel.replace(/^#/, "").toLowerCase();
    const webhooks = await scrapeWebhooks(args["app-id"]);
    const match = webhooks.filter((h) => h.channel.toLowerCase() === want);
    if (match.length === 0) {
      console.error(
        `No webhook for #${want} on ${args["app-id"]}. Available: ${webhooks.map((h) => "#" + h.channel).join(", ") || "(none)"}`,
      );
      process.exit(1);
    }
    // Most apps have one webhook per channel; print all if duplicated.
    for (const h of match) console.log(h.url);
  },
});

export const webhookAddCommand = defineCommand({
  meta: {
    name: "add",
    description: "Mint a new incoming webhook via OAuth (pick the channel in the browser)",
  },
  args: { ...appIdArg },
  async run({ args }) {
    const appId = args["app-id"];
    const app = getApp(appId);
    if (!app) {
      throw new Error(
        `App ${appId} not in local config. Run "slack2 import ${appId}" first (needs client_id/secret).`,
      );
    }

    const authorizeUrl =
      `https://slack.com/oauth/v2/authorize` +
      `?client_id=${app.client_id}` +
      `&scope=${encodeURIComponent("incoming-webhook")}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}`;

    console.log(`Authorizing an incoming webhook for ${app.name} (${appId}).`);
    console.log("Pick the target channel on the Slack consent screen.");
    const code = await waitForOAuthCode(authorizeUrl);

    const wh = await exchangeCodeForWebhook(
      code,
      app.client_id,
      app.client_secret,
      redirectUri(),
    );

    console.log(`\nChannel: ${wh.channel}`);
    console.log(`URL:     ${wh.url}`);
  },
});

export const webhookCommand = defineCommand({
  meta: {
    name: "webhook",
    description: "Manage an app's incoming webhooks",
  },
  subCommands: {
    list: webhookListCommand,
    get: webhookGetCommand,
    add: webhookAddCommand,
  },
});
