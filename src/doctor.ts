import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_IGNORE_DIRS } from "./constants.js";
import { parseEnv } from "./env-file.js";

const sourceExtensions = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".php",
  ".java",
  ".kt"
]);

const envPatterns = [
  /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g,
  /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g,
  /\bDeno\.env\.get\(["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\)/g,
  /\bBun\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g,
  /\bos\.getenv\(["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\)/g,
  /\bENV\[['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\]/g,
  /\bgetenv\(["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\)/g
];

export type DoctorReport = {
  usedKeys: string[];
  exampleKeys: string[];
  missingFromExamples: string[];
  unusedExamples: string[];
};

export async function runDoctor(root: string): Promise<DoctorReport> {
  const used = await scanUsedEnvKeys(root);
  const exampleKeys = await scanExampleKeys(root);
  const usedKeys = [...used].sort();
  const exampleKeyList = [...exampleKeys].sort();

  return {
    usedKeys,
    exampleKeys: exampleKeyList,
    missingFromExamples: usedKeys.filter((key) => !exampleKeys.has(key)),
    unusedExamples: exampleKeyList.filter((key) => !used.has(key))
  };
}

async function scanUsedEnvKeys(root: string): Promise<Set<string>> {
  const keys = new Set<string>();
  await walkSource(root, async (filePath) => {
    const content = await fs.readFile(filePath, "utf8");
    for (const pattern of envPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content))) {
        keys.add(match[1]);
      }
    }
  });
  return keys;
}

async function scanExampleKeys(root: string): Promise<Set<string>> {
  const keys = new Set<string>();
  await walkSource(root, async (filePath) => {
    if (!path.basename(filePath).endsWith(".example")) return;
    const content = await fs.readFile(filePath, "utf8");
    for (const entry of parseEnv(content)) keys.add(entry.key);
  }, true);
  return keys;
}

async function walkSource(root: string, visit: (filePath: string) => Promise<void>, includeExamples = false): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (!DEFAULT_IGNORE_DIRS.has(entry.name)) await walkSource(fullPath, visit, includeExamples);
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    const isExample = entry.name.startsWith(".env") && entry.name.endsWith(".example");
    if (sourceExtensions.has(ext) || (includeExamples && isExample)) {
      await visit(fullPath);
    }
  }
}
