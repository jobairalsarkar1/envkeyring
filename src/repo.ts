import fs from "node:fs/promises";
import path from "node:path";
import { ADMIN_PRIVATE_KEY_FILE, CONFIG_FILE, DEFAULT_IGNORE_DIRS, TOOL_DIR, TOOL_GITIGNORE_FILE, VAULT_FILE, VAULT_META_FILE } from "./constants.js";
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

export const RECOMMENDED_GITIGNORE_LINES = [
  `!${TOOL_DIR}/`,
  `!${TOOL_DIR}/${CONFIG_FILE}`,
  `!${TOOL_DIR}/${TOOL_GITIGNORE_FILE}`,
  `!${TOOL_DIR}/${VAULT_FILE}`,
  `!${TOOL_DIR}/${VAULT_META_FILE}`,
  `${TOOL_DIR}/${ADMIN_PRIVATE_KEY_FILE}`
];

export type GitignoreCheck = {
  gitignorePath: string;
  ignored: boolean;
  needsFix: boolean;
  matchedPatterns: string[];
  missingRecommendedLines: string[];
};

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

export function vaultMetaPath(root: string): string {
  return path.join(root, TOOL_DIR, VAULT_META_FILE);
}

export function adminPrivateKeyPath(root: string): string {
  return path.join(root, TOOL_DIR, ADMIN_PRIVATE_KEY_FILE);
}

export function toolGitignorePath(root: string): string {
  return path.join(root, TOOL_DIR, TOOL_GITIGNORE_FILE);
}

export function projectGitignorePath(root: string): string {
  return path.join(root, ".gitignore");
}

export async function checkProjectGitignore(root: string): Promise<GitignoreCheck> {
  const gitignorePath = projectGitignorePath(root);
  const content = await exists(gitignorePath) ? await fs.readFile(gitignorePath, "utf8") : "";
  const patterns = parseGitignoreLines(content);
  const matchedPatterns = patterns
    .filter((pattern) => !pattern.negated && gitignorePatternMatches(pattern.value, TOOL_DIR))
    .map((pattern) => pattern.raw);
  const unignorePatterns = patterns
    .filter((pattern) => pattern.negated && gitignorePatternMatches(pattern.value, TOOL_DIR))
    .map((pattern) => pattern.raw);
  const ignored = matchedPatterns.length > 0 && unignorePatterns.length === 0;
  const existingLines = new Set(patterns.map((pattern) => pattern.raw));
  const missingRecommendedLines = RECOMMENDED_GITIGNORE_LINES.filter((line) => !existingLines.has(line));
  const needsFix = ignored || (matchedPatterns.length > 0 && missingRecommendedLines.length > 0);

  return {
    gitignorePath,
    ignored,
    needsFix,
    matchedPatterns,
    missingRecommendedLines
  };
}

export async function fixProjectGitignore(root: string): Promise<GitignoreCheck> {
  const before = await checkProjectGitignore(root);
  if (!before.needsFix && before.missingRecommendedLines.length === 0) return before;

  const gitignorePath = projectGitignorePath(root);
  const existing = await exists(gitignorePath) ? await fs.readFile(gitignorePath, "utf8") : "";
  const lines = existing.trimEnd().length > 0
    ? [`${existing.trimEnd()}`, "", "# envkeyring vault files", ...before.missingRecommendedLines]
    : ["# envkeyring vault files", ...before.missingRecommendedLines];

  await fs.writeFile(gitignorePath, `${lines.join("\n")}\n`, "utf8");
  return checkProjectGitignore(root);
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
    exclude: raw.exclude ?? DEFAULT_EXCLUDE,
    signingPublicKey: raw.signingPublicKey,
    signingPublicKeyFingerprint: raw.signingPublicKeyFingerprint
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

function parseGitignoreLines(content: string): Array<{ raw: string; value: string; negated: boolean }> {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((raw) => {
      const negated = raw.startsWith("!");
      return {
        raw,
        negated,
        value: negated ? raw.slice(1) : raw
      };
    });
}

function gitignorePatternMatches(pattern: string, value: string): boolean {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized === value) return true;
  if (normalized === `${value}/`) return true;
  return globToRegExp(normalized).test(value);
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
