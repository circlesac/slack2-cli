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
import { adminCommand } from "./commands/admin.ts";
import { checkForUpdate } from "./lib/update-check.ts";
import { migrateLegacyPaths } from "./lib/paths.ts";
import { formatCliError } from "./lib/cli-safety.ts";
import pkg from "../package.json";

const main = defineCommand({
  meta: {
    name: "slack2",
    version: pkg.version,
    description:
      "Slack app lifecycle and workspace administration CLI",
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
    admin: adminCommand,
  },
});

migrateLegacyPaths();
await checkForUpdate();
// Citty logs thrown Error objects directly; Bun renders those with stack traces.
const originalConsoleError = console.error;
console.error = (...values: unknown[]) => {
  if (values[0] instanceof Error) {
    originalConsoleError(`Error: ${formatCliError(values[0])}`);
    return;
  }
  originalConsoleError(...values);
};
await runMain(main);
console.error = originalConsoleError;
