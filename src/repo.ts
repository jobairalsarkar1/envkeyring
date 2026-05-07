import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_FILE, DEFAULT_IGNORE_DIRS, TOOL_DIR, VAULT_FILE } from "./constants.js";
import { isEnvFileName } from "./env-file.js";
import { toPosixPath } from "./path-utils.js";
import type { EnvKeyringConfig } from "./types.js";

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
    vaultFile: VAULT_FILE
  };

  await fs.mkdir(toolDir, { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return true;
}

export function vaultPath(root: string): string {
  return path.join(root, TOOL_DIR, VAULT_FILE);
}

export async function discoverEnvFiles(root: string, scope?: string): Promise<string[]> {
  const start = scope ? path.resolve(root, scope) : root;
  const stat = await fs.stat(start);

  if (stat.isFile()) {
    return isEnvFileName(path.basename(start)) ? [start] : [];
  }

  const files: string[] = [];
  await walk(start, files);
  return files.sort((a, b) => toPosixPath(path.relative(root, a)).localeCompare(toPosixPath(path.relative(root, b))));
}

async function walk(dir: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!DEFAULT_IGNORE_DIRS.has(entry.name)) await walk(fullPath, files);
      continue;
    }

    if (entry.isFile() && isEnvFileName(entry.name)) {
      files.push(fullPath);
    }
  }
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
