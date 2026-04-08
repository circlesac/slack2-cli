import { defineCommand } from "citty";
import { loadApps } from "../lib/config.ts";

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List locally tracked Slack apps",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
  },
  run({ args }) {
    const apps = loadApps();

    if (apps.length === 0) {
      console.log('No apps found. Run "slack2 create" to create one.');
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(apps, null, 2));
      return;
    }

    for (const app of apps) {
      const status = app.bot_token ? "installed" : "created";
      console.log(`${app.app_id}  ${app.name}  [${status}]  ${app.workspace}`);
    }
  },
});
