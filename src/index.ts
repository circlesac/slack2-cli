#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { loginCommand } from "./commands/login.ts";
import { createCommand } from "./commands/create.ts";
import { installCommand } from "./commands/install.ts";
import { deleteCommand } from "./commands/delete.ts";
import { listCommand } from "./commands/list.ts";
import { updateCommand } from "./commands/update.ts";
import { tokenCommand } from "./commands/token.ts";
import pkg from "../package.json";

const main = defineCommand({
  meta: {
    name: "slack2",
    version: pkg.version,
    description: "Slack app lifecycle CLI",
  },
  subCommands: {
    login: loginCommand,
    create: createCommand,
    install: installCommand,
    delete: deleteCommand,
    list: listCommand,
    update: updateCommand,
    token: tokenCommand,
  },
});

runMain(main);
