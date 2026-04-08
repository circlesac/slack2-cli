import { defineCommand } from "citty";
import { getApp } from "../lib/config.ts";

export const tokenCommand = defineCommand({
  meta: {
    name: "token",
    description: "Print the bot token for an app",
  },
  args: {
    "app-id": {
      type: "positional",
      description: "App ID",
      required: true,
    },
  },
  run({ args }) {
    const app = getApp(args["app-id"]);
    if (!app) {
      throw new Error(`App ${args["app-id"]} not found in local config.`);
    }
    if (!app.bot_token) {
      throw new Error(
        `No bot token for ${app.name}. Run "slack2 install ${app.app_id}" first.`,
      );
    }
    // Print raw token for piping (e.g., slack2 token A123 | pbcopy)
    process.stdout.write(app.bot_token);
  },
});
