import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./package-info.js";
import { TOOL_NAME } from "./constants.js";
import { warn } from "./output.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 800;

type UpdateCache = {
  checkedAt: number;
  latestVersion: string;
};

export async function maybeNotifyUpdate(): Promise<void> {
  if (!shouldCheckForUpdates()) return;

  try {
    const cache = await readUpdateCache();
    const now = Date.now();

    if (cache && now - cache.checkedAt < CHECK_INTERVAL_MS) {
      notifyIfNewer(cache.latestVersion);
      return;
    }

    const latestVersion = await fetchLatestVersion();
    await writeUpdateCache({ checkedAt: now, latestVersion });
    notifyIfNewer(latestVersion);
  } catch {
    // Update checks are best-effort and must never affect the actual command.
  }
}

export function printCurrentVersion(): void {
  console.log(`${TOOL_NAME} ${PACKAGE_VERSION}`);
}

function shouldCheckForUpdates(): boolean {
  return process.stdout.isTTY
    && process.env["ENVKEYRING_NO_UPDATE_CHECK"] !== "1"
    && process.env["NO_UPDATE_CHECK"] !== "1"
    && process.env["CI"] !== "true";
}

function notifyIfNewer(latestVersion: string): void {
  if (!isVersionGreater(latestVersion, PACKAGE_VERSION)) return;

  warn(`${PACKAGE_NAME} ${latestVersion} is available. Current: ${PACKAGE_VERSION}.`);
  warn(`Run "npm install -D ${PACKAGE_NAME}@latest" or use "npx --yes ${PACKAGE_NAME}@latest".`);
}

async function fetchLatestVersion(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: controller.signal,
      headers: {
        "accept": "application/json",
        "user-agent": `${PACKAGE_NAME}/${PACKAGE_VERSION}`
      }
    });

    if (!response.ok) throw new Error(`npm registry returned ${response.status}`);
    const body = await response.json() as { version?: unknown };
    if (typeof body.version !== "string") throw new Error("npm registry response did not include a version");
    return body.version;
  } finally {
    clearTimeout(timeout);
  }
}

async function readUpdateCache(): Promise<UpdateCache | null> {
  try {
    const raw = await fs.readFile(updateCachePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<UpdateCache>;
    if (typeof parsed.checkedAt !== "number" || typeof parsed.latestVersion !== "string") return null;
    return { checkedAt: parsed.checkedAt, latestVersion: parsed.latestVersion };
  } catch {
    return null;
  }
}

async function writeUpdateCache(cache: UpdateCache): Promise<void> {
  const filePath = updateCachePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function updateCachePath(): string {
  const base = process.env["XDG_CACHE_HOME"] || path.join(os.homedir(), ".cache");
  return path.join(base, TOOL_NAME, "update-check.json");
}

function isVersionGreater(candidate: string, current: string): boolean {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);
  if (!candidateParts || !currentParts) return false;

  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] > currentParts[index]) return true;
    if (candidateParts[index] < currentParts[index]) return false;
  }

  return false;
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
