#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { loginCommand } from "./commands/login.ts";
import { createCommand } from "./commands/create.ts";
import { installCommand } from "./commands/install.ts";
import { deleteCommand } from "./commands/delete.ts";
import { listCommand } from "./commands/list.ts";
import { updateCommand } from "./commands/update.ts";
import { tokenCommand } from "./commands/token.ts";
import { importCommand } from "./commands/import.ts";
import { webhookCommand } from "./commands/webhook.ts";
import { distributeCommand } from "./commands/distribute.ts";
import { checkForUpdate } from "./lib/update-check.ts";
import { migrateLegacyPaths } from "./lib/paths.ts";
import pkg from "../package.json";

const main = defineCommand({
  meta: {
    name: "slack2",
    version: pkg.version,
    description:
      "Slack app lifecycle CLI (use the official Slack CLI for app profiles and icons)",
  },
  subCommands: {
    login: loginCommand,
    create: createCommand,
    install: installCommand,
    delete: deleteCommand,
    list: listCommand,
    update: updateCommand,
    token: tokenCommand,
    import: importCommand,
    webhook: webhookCommand,
    distribute: distributeCommand,
  },
});

migrateLegacyPaths();
await checkForUpdate();
runMain(main);
