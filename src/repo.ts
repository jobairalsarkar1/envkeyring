import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_FILE, DEFAULT_IGNORE_DIRS, TOOL_DIR, VAULT_FILE } from "./constants.js";
import { toPosixPath } from "./path-utils.js";
import type { EnvKeyringConfig } from "./types.js";

export const DEFAULT_INCLUDE = [".env", ".env.*", "**/.env", "**/.env.*"];
export const DEFAULT_EXCLUDE = [
  ".env.example",
  ".env.*.example",
  ".env.sample",
  ".env.*.sample",
  ".env.template",
  ".env.*.template",
  "**/.env.example",
  "**/.env.*.example",
  "**/.env.sample",
  "**/.env.*.sample",
  "**/.env.template",
  "**/.env.*.template"
];

export async function findRepoRoot(start = process.cwd()): Promise<string | null> {
  let current = path.resolve(start);

  while (true) {
    if (await exists(path.join(current, TOOL_DIR))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function inferInitRoot(start = process.cwd()): Promise<string> {
  let current = path.resolve(start);

  while (true) {
    if (await exists(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export async function initRepo(root: string): Promise<boolean> {
  const toolDir = path.join(root, TOOL_DIR);
  const configPath = path.join(toolDir, CONFIG_FILE);

  if (await exists(configPath)) return false;

  const config: EnvKeyringConfig = {
    version: 1,
    createdAt: new Date().toISOString(),
    vaultFile: VAULT_FILE,
    include: DEFAULT_INCLUDE,
    exclude: DEFAULT_EXCLUDE
  };

  await fs.mkdir(toolDir, { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return true;
}

export function vaultPath(root: string): string {
  return path.join(root, TOOL_DIR, VAULT_FILE);
}

export async function discoverEnvFiles(root: string, scope?: string): Promise<string[]> {
  const config = await readConfig(root);
  const start = scope ? path.resolve(root, scope) : root;
  const stat = await fs.stat(start);

  if (stat.isFile()) {
    return matchesDiscoveryRules(root, start, config) ? [start] : [];
  }

  const files: string[] = [];
  await walk(root, start, files, config);
  return files.sort((a, b) => toPosixPath(path.relative(root, a)).localeCompare(toPosixPath(path.relative(root, b))));
}

export async function readConfig(root: string): Promise<EnvKeyringConfig> {
  const configPath = path.join(root, TOOL_DIR, CONFIG_FILE);
  const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as Partial<EnvKeyringConfig>;

  return {
    version: 1,
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    vaultFile: raw.vaultFile ?? VAULT_FILE,
    include: raw.include ?? DEFAULT_INCLUDE,
    exclude: raw.exclude ?? DEFAULT_EXCLUDE
  };
}

export async function writeConfig(root: string, config: EnvKeyringConfig): Promise<void> {
  await fs.writeFile(path.join(root, TOOL_DIR, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function walk(root: string, dir: string, files: string[], config: EnvKeyringConfig): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!DEFAULT_IGNORE_DIRS.has(entry.name)) await walk(root, fullPath, files, config);
      continue;
    }

    if (entry.isFile() && matchesDiscoveryRules(root, fullPath, config)) {
      files.push(fullPath);
    }
  }
}

function matchesDiscoveryRules(root: string, filePath: string, config: EnvKeyringConfig): boolean {
  const relativePath = toPosixPath(path.relative(root, filePath));
  return config.include.some((pattern) => matchGlob(pattern, relativePath))
    && !config.exclude.some((pattern) => matchGlob(pattern, relativePath));
}

function matchGlob(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*") {
      if (next === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
