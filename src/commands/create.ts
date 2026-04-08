import { defineCommand } from "citty";
import { getWorkspaceToken } from "../lib/credentials.ts";
import { slackApi } from "../lib/slack-api.ts";
import { addApp, type AppEntry } from "../lib/config.ts";
import { redirectUri } from "../lib/oauth.ts";

export const createCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create a Slack app via Manifest API",
  },
  args: {
    name: {
      type: "positional",
      description: "App display name",
      required: true,
    },
    workspace: {
      type: "string",
      alias: "w",
      description: "Slack workspace domain (from ~/.slack/credentials.json)",
      required: true,
    },
    description: {
      type: "string",
      alias: "d",
      description: "App description",
      default: "",
    },
    scopes: {
      type: "string",
      alias: "s",
      description: "Comma-separated bot scopes",
      default: "chat:write,chat:write.public,channels:history,channels:read",
    },
    "user-scopes": {
      type: "string",
      description: "Comma-separated user scopes",
      default: "",
    },
  },
  async run({ args }) {
    const userToken = await getWorkspaceToken(args.workspace);
    console.log(`Using workspace: ${args.workspace}`);

    const botScopes = args.scopes.split(",").filter(Boolean);
    const userScopes = args["user-scopes"]
      ? args["user-scopes"].split(",").filter(Boolean)
      : [];

    const manifest: Record<string, unknown> = {
      display_information: {
        name: args.name,
        description: args.description || `${args.name} Slack app`,
      },
      features: {
        bot_user: {
          display_name: args.name,
          always_online: false,
        },
      },
      oauth_config: {
        redirect_urls: [redirectUri()],
        scopes: {
          bot: botScopes,
          ...(userScopes.length > 0 ? { user: userScopes } : {}),
        },
      },
      settings: {
        org_deploy_enabled: false,
        socket_mode_enabled: false,
      },
    };

    const res = await slackApi("apps.manifest.create", userToken, { manifest });

    const appId = res.app_id as string;
    const credentials = res.credentials as { client_id: string; client_secret: string };

    const entry: AppEntry = {
      app_id: appId,
      name: args.name,
      workspace: args.workspace,
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      created_at: new Date().toISOString(),
    };
    addApp(entry);

    console.log(`\nApp created: ${appId}`);
    console.log(`  client_id:     ${credentials.client_id}`);
    console.log(`  client_secret: ${credentials.client_secret}`);
    console.log(`\nRun "slack2 install ${appId}" to install and get a bot token.`);
  },
});
