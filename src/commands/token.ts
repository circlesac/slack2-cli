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
    user: {
      type: "boolean",
      description: "Print the installed user OAuth token instead of the bot token",
      default: false,
    },
  },
  run({ args }) {
    const app = getApp(args["app-id"]);
    if (!app) {
      throw new Error(`App ${args["app-id"]} not found in local config.`);
    }
    const token = args.user ? app.user_token : app.bot_token;
    if (!token) {
      throw new Error(
        `No ${args.user ? "user" : "bot"} token for ${app.name}. Run "slack2 install ${app.app_id}" first.`,
      );
    }
    process.stdout.write(token);
  },
});
