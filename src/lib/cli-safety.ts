import { createInterface } from "node:readline/promises";

export async function confirmMutation(
  question: string,
  options: { yes?: boolean; dryRun?: boolean },
): Promise<boolean> {
  if (options.dryRun) return false;
  if (options.yes) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Confirmation requires an interactive terminal. Re-run with --yes or --dry-run.",
    );
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(`${question} [y/N] `);
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

const SENSITIVE_KEY =
  /^(token|api_token|access_token|refresh_token|cookie|client_secret|signing_secret|password)$/i;
const NETWORK_KEY = /^(ip|ip_address|user_agent|isp)$/i;

export function redactSensitive(
  value: unknown,
  options: { includeNetwork?: boolean } = {},
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry, options));
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      return value.replace(
        /xox[abcdoprst]-[A-Za-z0-9%_.~+-]+/g,
        "[REDACTED]",
      );
    }
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (SENSITIVE_KEY.test(key)) return [key, "[REDACTED]"];
      if (!options.includeNetwork && NETWORK_KEY.test(key)) {
        return [key, "[REDACTED]"];
      }
      return [key, redactSensitive(entry, options)];
    }),
  );
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function toEpochSeconds(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(
      `Invalid timestamp "${value}". Use an ISO date/time or Unix seconds.`,
    );
  }
  return Math.floor(milliseconds / 1000);
}

export function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return parsed;
}

export function formatEpoch(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return "-";
  return new Date(seconds * 1000).toISOString();
}

export function collectRepeatedOption(
  rawArgs: string[],
  name: string,
): string[] {
  const long = `--${name}`;
  const values: string[] = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]!;
    if (arg === long) {
      const value = rawArgs[index + 1];
      if (value !== undefined && !value.startsWith("--")) {
        values.push(value);
        index += 1;
      }
    } else if (arg.startsWith(`${long}=`)) {
      values.push(arg.slice(long.length + 1));
    }
  }
  return values;
}
