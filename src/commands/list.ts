import { defineCommand } from "citty";
import { loadApps } from "../lib/config.ts";
import { fetchRemoteApps } from "../lib/remote.ts";

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List Slack apps from api.slack.com",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
      default: false,
    },
  },
  async run({ args }) {
    const remoteApps = await fetchRemoteApps();
    const localApps = loadApps();

    const merged = remoteApps.map((r) => {
      const local = localApps.find((l) => l.app_id === r.appId);
      return {
        ...r,
        hasToken: !!local?.bot_token,
      };
    });

    if (merged.length === 0) {
      console.log("No apps found.");
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(merged, null, 2));
      return;
    }

    console.log(
      `${"App ID".padEnd(17)}${"Name".padEnd(21)}${"Workspace".padEnd(16)}${"Token".padEnd(8)}Distribution`,
    );
    console.log("\u2500".repeat(80));
    for (const app of merged) {
      console.log(
        `${app.appId.padEnd(17)}${app.name.padEnd(21)}${app.workspace.padEnd(16)}${(app.hasToken ? "yes" : "-").padEnd(8)}${app.distribution}`,
      );
    }
  },
});
