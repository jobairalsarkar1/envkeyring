import fs from "node:fs/promises";
import path from "node:path";
import type { EnvEntry } from "./types.js";

const keyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isEnvFileName(fileName: string): boolean {
  if (!fileName.startsWith(".env")) return false;
  if (fileName.endsWith(".example")) return false;
  if (fileName.endsWith(".sample")) return false;
  if (fileName.endsWith(".template")) return false;
  return true;
}

export function examplePathFor(envPath: string): string {
  return `${envPath}.example`;
}

export function parseEnv(content: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  const seen = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const separator = withoutExport.indexOf("=");
    if (separator === -1) continue;

    const key = withoutExport.slice(0, separator).trim();
    if (!keyPattern.test(key) || seen.has(key)) continue;

    const value = parseValue(withoutExport.slice(separator + 1).trim());
    entries.push({ key, value });
    seen.add(key);
  }

  return entries;
}

function parseValue(value: string): string {
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === `"` || quote === `'`) && value[value.length - 1] === quote) {
      return value.slice(1, -1);
    }
  }

  const hashIndex = value.indexOf(" #");
  return hashIndex === -1 ? value : value.slice(0, hashIndex).trimEnd();
}

export function stringifyEnv(entries: EnvEntry[]): string {
  return `${entries.map(({ key, value }) => `${key}=${formatValue(value)}`).join("\n")}\n`;
}

export function stringifyExample(entries: EnvEntry[]): string {
  const keys = [...new Set(entries.map((entry) => entry.key))].sort();
  return `${keys.map((key) => `${key}=<encrypted>`).join("\n")}\n`;
}

function formatValue(value: string): string {
  if (value === "") return "";
  if (/[\s#"'\\]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

export async function readEnvFile(filePath: string): Promise<EnvEntry[]> {
  const content = await fs.readFile(filePath, "utf8");
  return parseEnv(content);
}

export async function writeEnvFile(filePath: string, entries: EnvEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringifyEnv(entries), "utf8");
}

export async function writeExampleFile(envPath: string, entries: EnvEntry[]): Promise<void> {
  await fs.writeFile(examplePathFor(envPath), stringifyExample(entries), "utf8");
}
