#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { TOOL_DIR, TOOL_NAME } from "./constants.js";
import { decryptVault, encryptVault } from "./crypto.js";
import { runDoctor } from "./doctor.js";
import { examplePathFor, readEnvFile, writeEnvFile, writeExampleFile } from "./env-file.js";
import { askSecret } from "./prompt.js";
import { discoverEnvFiles, exists, findRepoRoot, inferInitRoot, initRepo, readConfig, vaultPath } from "./repo.js";
import { fromPosixPath, toPosixPath } from "./path-utils.js";
import { empty, field, heading, item, success, warn } from "./output.js";
import { chooseEnvFiles } from "./interactive-seal.js";
import type { VaultEnvelope, VaultPayload } from "./types.js";

type CliOptions = {
  force: boolean;
  interactive: boolean;
  scope?: string;
};

const [, , command = "help", ...args] = process.argv;

try {
  await main(command, args);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${TOOL_NAME}: ${message}`);
  process.exitCode = 1;
}

async function main(cmd: string, args: string[]): Promise<void> {
  if (cmd === "help" || cmd === "--help" || cmd === "-h") return printHelp();
  if (cmd === "init") return commandInit();
  if (cmd === "status") return commandStatus(parseOptions(args));
  if (cmd === "seal") return commandSeal(parseOptions(args));
  if (cmd === "unlock") return commandUnlock(parseOptions(args));
  if (cmd === "verify") return commandVerify();
  if (cmd === "list") return commandList(parseOptions(args));
  if (cmd === "rotate-key") return commandRotateKey();
  if (cmd === "doctor") return commandDoctor(parseOptions(args));

  throw new Error(`Unknown command "${cmd}". Run "envkeyring help".`);
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = { force: false, interactive: false };
  for (const arg of args) {
    if (arg === "--force" || arg === "-f") {
      options.force = true;
    } else if (arg === "--interactive" || arg === "-i") {
      options.interactive = true;
    } else if (!options.scope) {
      options.scope = arg;
    } else {
      throw new Error(`Unexpected argument "${arg}".`);
    }
  }
  return options;
}

async function commandInit(): Promise<void> {
  const root = await inferInitRoot();
  const created = await initRepo(root);
  const relative = path.relative(process.cwd(), path.join(root, TOOL_DIR)) || TOOL_DIR;

  if (created) {
    success(`Initialized ${TOOL_NAME} at ${relative}`);
  } else {
    warn(`${TOOL_NAME} is already initialized at ${relative}`);
  }
}

async function commandStatus(options: CliOptions): Promise<void> {
  const root = await findRepoRoot();
  if (!root) {
    heading(`${TOOL_NAME} status`);
    field("Initialized", "no");
    warn(`Run "envkeyring init" to create ${TOOL_DIR}/.`);
    return;
  }

  const envFiles = await discoverEnvFiles(root, options.scope);
  const vaultExists = await exists(vaultPath(root));
  const config = await readConfig(root);

  heading(`${TOOL_NAME} status`);
  field("Root", path.relative(process.cwd(), root) || ".");
  field("Initialized", "yes");
  field("Vault", vaultExists ? path.relative(process.cwd(), vaultPath(root)) : "missing");
  field("Env files", envFiles.length);
  field("Include", config.include.join(", "));
  field("Exclude", config.exclude.join(", "));

  if (envFiles.length === 0) {
    empty();
    return;
  }

  for (const filePath of envFiles) {
    const relativePath = toPosixPath(path.relative(root, filePath));
    const exampleExists = await exists(examplePathFor(filePath));
    item(`${relativePath} (${exampleExists ? "example ok" : "missing example"})`);
  }
}

async function commandSeal(options: CliOptions): Promise<void> {
  const root = await requireRoot();
  const envFiles = await discoverEnvFiles(root, options.scope);

  if (envFiles.length === 0) {
    throw new Error("No .env files found to seal.");
  }

  const selectedEnvFiles = options.interactive ? await chooseEnvFiles(root, envFiles) : envFiles;
  if (selectedEnvFiles.length === 0) {
    warn("No env files selected.");
    return;
  }

  const passphrase = await readNewPassphrase();
  const files = [];

  for (const filePath of selectedEnvFiles) {
    const entries = await readEnvFile(filePath);
    if (entries.length === 0) continue;

    await writeExampleFile(filePath, entries);
    files.push({
      path: toPosixPath(path.relative(root, filePath)),
      entries
    });
  }

  if (files.length === 0) throw new Error("No env variables found in discovered .env files.");

  const payload: VaultPayload = {
    version: 1,
    sealedAt: new Date().toISOString(),
    files
  };

  await fs.writeFile(vaultPath(root), `${JSON.stringify(encryptVault(payload, passphrase), null, 2)}\n`, "utf8");

  success(`Sealed ${files.length} env file${files.length === 1 ? "" : "s"} into ${path.relative(process.cwd(), vaultPath(root))}`);
  for (const file of files) {
    item(file.path);
  }
}

async function commandUnlock(options: CliOptions): Promise<void> {
  const root = await requireRoot();
  const vault = await readVault(root);
  const passphrase = await askSecret("Unlock key: ");
  const payload = decryptVault(vault, passphrase);
  const selectedFiles = options.scope !== undefined
    ? selectScopedFiles(payload.files, options.scope)
    : payload.files;

  if (selectedFiles.length === 0) throw new Error("No sealed env files matched that scope.");

  let written = 0;
  for (const file of selectedFiles) {
    const target = fromPosixPath(root, file.path);
    if (!options.force && await exists(target)) {
      warn(`Skipped existing ${file.path} (use --force to overwrite)`);
      continue;
    }

    await writeEnvFile(target, file.entries);
    written += 1;
    item(`Wrote ${file.path}`);
  }

  success(`Unlocked ${written} env file${written === 1 ? "" : "s"}.`);
}

async function commandVerify(): Promise<void> {
  const root = await requireRoot();
  const vault = await readVault(root);
  const passphrase = await askSecret("Unlock key: ");
  const payload = decryptVault(vault, passphrase);

  success(`Unlock key verified for ${payload.files.length} sealed env file${payload.files.length === 1 ? "" : "s"}.`);
  for (const file of payload.files) {
    item(file.path);
  }
}

async function commandList(options: CliOptions): Promise<void> {
  const root = await requireRoot();
  const vault = await readVault(root);
  const passphrase = await askSecret("Unlock key: ");
  const payload = decryptVault(vault, passphrase);
  const selectedFiles = options.scope !== undefined
    ? selectScopedFiles(payload.files, options.scope)
    : payload.files;

  if (selectedFiles.length === 0) throw new Error("No sealed env files matched that scope.");

  heading(`Vault contains ${selectedFiles.length} sealed env file${selectedFiles.length === 1 ? "" : "s"}:`);
  for (const file of selectedFiles) {
    console.log(`\n${file.path}`);
    for (const entry of file.entries) {
      item(entry.key);
    }
  }
}

async function commandRotateKey(): Promise<void> {
  const root = await requireRoot();
  const vault = await readVault(root);
  const currentPassphrase = await askSecret("Current unlock key: ");
  const payload = decryptVault(vault, currentPassphrase);
  const newPassphrase = await readNewPassphrase();

  await fs.writeFile(vaultPath(root), `${JSON.stringify(encryptVault(payload, newPassphrase), null, 2)}\n`, "utf8");
  success(`Rotated unlock key for ${payload.files.length} sealed env file${payload.files.length === 1 ? "" : "s"}.`);
}

function selectScopedFiles(files: VaultPayload["files"], scope: string): VaultPayload["files"] {
  const normalizedScope = toPosixPath(scope).replace(/\/$/, "");
  return files.filter((file) => file.path === normalizedScope || file.path.startsWith(`${normalizedScope}/`));
}

async function commandDoctor(options: CliOptions): Promise<void> {
  const root = await requireRoot();
  const reportRoot = options.scope ? path.resolve(root, options.scope) : root;
  const report = await runDoctor(reportRoot);

  heading(`${TOOL_NAME} doctor`);
  field("Used env keys found", report.usedKeys.length);
  field("Example env keys found", report.exampleKeys.length);

  printKeyList("Used in code but missing from examples", report.missingFromExamples);
  printKeyList("Present in examples but not found in code", report.unusedExamples);
}

async function requireRoot(): Promise<string> {
  const root = await findRepoRoot();
  if (!root) throw new Error(`No ${TOOL_DIR} folder found. Run "envkeyring init" first.`);
  return root;
}

async function readVault(root: string): Promise<VaultEnvelope> {
  const filePath = vaultPath(root);
  if (!await exists(filePath)) throw new Error("No vault found. Ask an admin to run \"envkeyring seal\" first.");
  return JSON.parse(await fs.readFile(filePath, "utf8")) as VaultEnvelope;
}

async function readNewPassphrase(): Promise<string> {
  const passphrase = await askSecret("New unlock key: ");
  if (passphrase.length < 8) throw new Error("Unlock key must be at least 8 characters.");
  const confirmation = await askSecret("Confirm unlock key: ");
  if (passphrase !== confirmation) throw new Error("Unlock keys did not match.");
  return passphrase;
}

function printKeyList(label: string, keys: string[]): void {
  console.log(`\n${label}:`);
  if (keys.length === 0) {
    empty();
    return;
  }

  for (const key of keys) {
    item(key);
  }
}

function printHelp(): void {
  console.log(`envkeyring

Usage:
  envkeyring init
  envkeyring status [path]
  envkeyring seal [path] [--interactive]
  envkeyring unlock [path] [--force]
  envkeyring verify
  envkeyring list [path]
  envkeyring rotate-key
  envkeyring doctor [path]

Aliases:
  ekr

Commands:
  init      Create a project-local .envkeyring folder
  status    Show vault and env file state
  seal      Encrypt discovered .env files and generate .env.example files
  unlock    Restore .env files from the encrypted vault
  verify    Check an unlock key without writing .env files
  list      List sealed env files and variable names without showing values
  rotate-key
            Re-encrypt the vault with a new unlock key
  doctor    Compare env usage in code with checked-in examples
`);
}
