export const TOOL_NAME = "envkeyring";
export const TOOL_DIR = ".envkeyring";
export const CONFIG_FILE = "config.json";
export const VAULT_FILE = "vault.enc.json";
export const VAULT_META_FILE = "vault.meta.json";
export const VAULT_VERSION = 1;

export const DEFAULT_IGNORE_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".envkeyring",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache"
]);
