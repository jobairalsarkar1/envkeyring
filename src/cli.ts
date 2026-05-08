#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ADMIN_PRIVATE_KEY_FILE, TOOL_DIR, TOOL_NAME } from "./constants.js";
import { decryptVault, encryptVault } from "./crypto.js";
import { runDoctor } from "./doctor.js";
import { examplePathFor, readEnvFile, writeEnvFile, writeExampleFile } from "./env-file.js";
import { askSecret } from "./prompt.js";
import { adminPrivateKeyPath, DEFAULT_EXCLUDE, DEFAULT_INCLUDE, discoverEnvFiles, exists, findRepoRoot, inferInitRoot, initRepo, readConfig, toolGitignorePath, vaultMetaPath, vaultPath, writeConfig } from "./repo.js";
import { fromPosixPath, toPosixPath } from "./path-utils.js";
import { empty, field, heading, item, success, warn } from "./output.js";
import { chooseEnvFiles } from "./interactive-seal.js";
import type { EnvKeyringConfig, VaultEnvelope, VaultMetadata, VaultMetaFile, VaultPayload } from "./types.js";

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
  if (cmd === "admin") return commandAdmin(args);
  if (cmd === "config") return commandConfig(args);
  if (cmd === "status") return commandStatus(parseOptions(args));
  if (cmd === "seal") return commandSeal(parseOptions(args));
  if (cmd === "reseal") return commandReseal(parseOptions(args));
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

async function commandConfig(args: string[]): Promise<void> {
  const root = await requireRoot();
  const config = await readConfig(root);
  const [action, pattern, ...extra] = args;

  if (extra.length > 0) throw new Error(`Unexpected argument "${extra[0]}".`);

  if (action === undefined || action === "show") {
    printConfig(config);
    return;
  }

  if (action === "upgrade") {
    const addedIncludes = addPatterns(config.include, DEFAULT_INCLUDE);
    const addedExcludes = addPatterns(config.exclude, DEFAULT_EXCLUDE);
    await writeConfig(root, config);
    success(`Upgraded config with ${addedIncludes} include pattern${addedIncludes === 1 ? "" : "s"} and ${addedExcludes} exclude pattern${addedExcludes === 1 ? "" : "s"}.`);
    return;
  }

  if (!pattern) throw new Error(`Missing pattern for "config ${action}".`);

  if (action === "add-include") {
    addPattern(config.include, pattern);
    await writeConfig(root, config);
    success(`Added include pattern ${pattern}`);
    return;
  }

  if (action === "add-exclude") {
    addPattern(config.exclude, pattern);
    await writeConfig(root, config);
    success(`Added exclude pattern ${pattern}`);
    return;
  }

  if (action === "remove-include") {
    removePattern(config.include, pattern);
    await writeConfig(root, config);
    success(`Removed include pattern ${pattern}`);
    return;
  }

  if (action === "remove-exclude") {
    removePattern(config.exclude, pattern);
    await writeConfig(root, config);
    success(`Removed exclude pattern ${pattern}`);
    return;
  }

  throw new Error(`Unknown config action "${action}". Run "envkeyring help".`);
}

async function commandAdmin(args: string[]): Promise<void> {
  const root = await requireRoot();
  const [action = "status", ...rest] = args;

  if (action === "status") {
    const config = await readConfig(root);
    heading(`${TOOL_NAME} admin`);
    field("Signing", config.signingPublicKey ? "configured" : "not configured");
    if (config.signingPublicKeyFingerprint) field("Public key", config.signingPublicKeyFingerprint);
    field("Private key", await exists(adminPrivateKeyPath(root)) ? path.relative(process.cwd(), adminPrivateKeyPath(root)) : "missing");
    return;
  }

  if (action === "init") {
    const force = rest.includes("--force") || rest.includes("-f");
    if (rest.some((arg) => arg !== "--force" && arg !== "-f")) throw new Error(`Unexpected argument "${rest.find((arg) => arg !== "--force" && arg !== "-f")}".`);
    await initAdminSigning(root, force);
    return;
  }

  throw new Error(`Unknown admin action "${action}". Run "envkeyring help".`);
}

async function initAdminSigning(root: string, force: boolean): Promise<void> {
  const privatePath = adminPrivateKeyPath(root);
  if (!force && await exists(privatePath)) {
    throw new Error("Admin private signing key already exists. Use \"envkeyring admin init --force\" to replace it.");
  }

  const config = await readConfig(root);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const fingerprint = publicKeyFingerprint(publicPem);

  await fs.writeFile(privatePath, privatePem, { encoding: "utf8", mode: 0o600 });
  await ensureToolGitignore(root, ADMIN_PRIVATE_KEY_FILE);

  config.signingPublicKey = publicPem;
  config.signingPublicKeyFingerprint = fingerprint;
  await writeConfig(root, config);

  success(`Initialized admin signing key ${fingerprint}`);
  warn(`${path.relative(process.cwd(), privatePath)} is required to sign future seal/reseal updates. Do not share or commit it.`);
}

async function ensureToolGitignore(root: string, entry: string): Promise<void> {
  const gitignorePath = toolGitignorePath(root);
  const existing = await exists(gitignorePath) ? await fs.readFile(gitignorePath, "utf8") : "";
  const lines = existing.split(/\r?\n/).filter(Boolean);
  if (!lines.includes(entry)) {
    lines.push(entry);
    await fs.writeFile(gitignorePath, `${lines.join("\n")}\n`, "utf8");
  }
}

function printConfig(config: { include: string[]; exclude: string[] }): void {
  heading(`${TOOL_NAME} config`);
  console.log("\ninclude:");
  for (const pattern of config.include) item(pattern);
  console.log("\nexclude:");
  for (const pattern of config.exclude) item(pattern);
}

function addPattern(patterns: string[], pattern: string): void {
  if (!patterns.includes(pattern)) patterns.push(pattern);
}

function addPatterns(patterns: string[], defaults: string[]): number {
  let added = 0;
  for (const pattern of defaults) {
    if (!patterns.includes(pattern)) {
      patterns.push(pattern);
      added += 1;
    }
  }
  return added;
}

function removePattern(patterns: string[], pattern: string): void {
  const index = patterns.indexOf(pattern);
  if (index !== -1) patterns.splice(index, 1);
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
  const meta = vaultExists ? await readVaultMetadata(root) : null;
  const config = await readConfig(root);
  const signatureStatus = meta ? verifyVaultMetadataSignature(meta, config) : null;

  heading(`${TOOL_NAME} status`);
  field("Root", path.relative(process.cwd(), root) || ".");
  field("Initialized", "yes");
  field("Vault", vaultExists ? path.relative(process.cwd(), vaultPath(root)) : "missing");
  if (meta) {
    field("Revision", meta.revision);
    field("Last sealed", `${meta.sealedAt} by ${meta.sealedBy}`);
    field("Signature", signatureStatus ?? "not checked");
  }
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
  if (!options.force && await exists(vaultPath(root))) {
    throw new Error("Vault already exists. Use \"envkeyring reseal\" to update it, or \"envkeyring seal --force\" to replace it.");
  }

  await writeSealedVault(root, options, "seal");
}

async function commandReseal(options: CliOptions): Promise<void> {
  const root = await requireRoot();
  if (!await exists(vaultPath(root))) {
    throw new Error("No vault found. Run \"envkeyring seal\" first.");
  }

  await writeSealedVault(root, options, "reseal");
}

async function writeSealedVault(root: string, options: CliOptions, action: "seal" | "reseal"): Promise<void> {
  const envFiles = await discoverEnvFiles(root, options.scope);

  if (envFiles.length === 0) {
    throw new Error(`No .env files found to ${action}.`);
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
  const previousMeta = await readVaultMetadata(root);
  const config = await readConfig(root);
  const nextMeta = await createVaultMetadata(root, payload, previousMeta, config);

  await fs.writeFile(vaultPath(root), `${JSON.stringify(encryptVault(payload, passphrase), null, 2)}\n`, "utf8");
  await fs.writeFile(vaultMetaPath(root), `${JSON.stringify(nextMeta, null, 2)}\n`, "utf8");

  success(`${action === "seal" ? "Sealed" : "Resealed"} ${files.length} env file${files.length === 1 ? "" : "s"} into ${path.relative(process.cwd(), vaultPath(root))} (revision ${nextMeta.revision})`);
  for (const file of files) {
    item(file.path);
  }
}

async function readVaultMetadata(root: string): Promise<VaultMetadata | null> {
  const filePath = vaultMetaPath(root);
  if (!await exists(filePath)) return null;
  return JSON.parse(await fs.readFile(filePath, "utf8")) as VaultMetadata;
}

async function createVaultMetadata(root: string, payload: VaultPayload, previous: VaultMetadata | null, config: EnvKeyringConfig): Promise<VaultMetadata> {
  const files = payload.files.map((file) => ({
    path: file.path,
    keys: file.entries.map((entry) => entry.key).sort()
  }));

  const metadata: VaultMetadata = {
    version: 1,
    revision: (previous?.revision ?? 0) + 1,
    sealedAt: payload.sealedAt,
    sealedBy: currentActor(),
    files,
    changes: diffVaultFiles(previous?.files ?? [], files)
  };

  if (config.signingPublicKey) {
    metadata.signature = await signVaultMetadata(root, metadata, config);
  }

  return metadata;
}

async function signVaultMetadata(root: string, metadata: VaultMetadata, config: EnvKeyringConfig) {
  if (!config.signingPublicKey) throw new Error("Admin signing public key is not configured.");
  const privatePath = adminPrivateKeyPath(root);
  if (!await exists(privatePath)) {
    throw new Error(`Admin signing is configured, but ${ADMIN_PRIVATE_KEY_FILE} is missing. Only the admin signing key can seal or reseal this vault.`);
  }

  const privateKey = await fs.readFile(privatePath, "utf8");
  const value = crypto.sign(null, Buffer.from(canonicalVaultMetadata(metadata)), privateKey).toString("base64");
  return {
    algorithm: "ed25519" as const,
    publicKeyFingerprint: config.signingPublicKeyFingerprint ?? publicKeyFingerprint(config.signingPublicKey),
    value
  };
}

function verifyVaultMetadataSignature(metadata: VaultMetadata, config: EnvKeyringConfig): string {
  if (!config.signingPublicKey) return "not configured";
  if (!metadata.signature) return "missing";
  if (metadata.signature.publicKeyFingerprint !== publicKeyFingerprint(config.signingPublicKey)) return "invalid public key";

  const ok = crypto.verify(
    null,
    Buffer.from(canonicalVaultMetadata(metadata)),
    config.signingPublicKey,
    Buffer.from(metadata.signature.value, "base64")
  );

  return ok ? `valid (${metadata.signature.publicKeyFingerprint})` : "invalid";
}

function canonicalVaultMetadata(metadata: VaultMetadata): string {
  const { signature: _signature, ...unsigned } = metadata;
  return JSON.stringify(sortObject(unsigned));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortObject(nestedValue)])
    );
  }
  return value;
}

function publicKeyFingerprint(publicKey: string): string {
  return crypto.createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
}

function currentActor(): string {
  return process.env["USER"] || process.env["USERNAME"] || os.userInfo().username || "unknown";
}

function diffVaultFiles(previous: VaultMetaFile[], next: VaultMetaFile[]) {
  const previousMap = new Map(previous.map((file) => [file.path, new Set(file.keys)]));
  const nextMap = new Map(next.map((file) => [file.path, new Set(file.keys)]));
  const addedFiles = next.filter((file) => !previousMap.has(file.path)).map((file) => file.path);
  const removedFiles = previous.filter((file) => !nextMap.has(file.path)).map((file) => file.path);
  const addedKeys: Record<string, string[]> = {};
  const removedKeys: Record<string, string[]> = {};

  for (const file of next) {
    const oldKeys = previousMap.get(file.path);
    if (!oldKeys) continue;
    const added = file.keys.filter((key) => !oldKeys.has(key));
    if (added.length > 0) addedKeys[file.path] = added;
  }

  for (const file of previous) {
    const newKeys = nextMap.get(file.path);
    if (!newKeys) continue;
    const removed = file.keys.filter((key) => !newKeys.has(key));
    if (removed.length > 0) removedKeys[file.path] = removed;
  }

  return { addedFiles, removedFiles, addedKeys, removedKeys };
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
  envkeyring admin [status]
  envkeyring admin init [--force]
  envkeyring config [show]
  envkeyring config upgrade
  envkeyring config add-include <pattern>
  envkeyring config add-exclude <pattern>
  envkeyring config remove-include <pattern>
  envkeyring config remove-exclude <pattern>
  envkeyring status [path]
  envkeyring seal [path] [--interactive]
  envkeyring reseal [path] [--interactive]
  envkeyring unlock [path] [--force]
  envkeyring verify
  envkeyring list [path]
  envkeyring rotate-key
  envkeyring doctor [path]

Aliases:
  ekr

Commands:
  init      Create a project-local .envkeyring folder
  admin     Configure optional admin signing for vault metadata
  config    Show or update env discovery rules
  status    Show vault and env file state
  seal      Encrypt discovered .env files and generate .env.example files
  reseal    Explicitly update an existing encrypted vault
  unlock    Restore .env files from the encrypted vault
  verify    Check an unlock key without writing .env files
  list      List sealed env files and variable names without showing values
  rotate-key
            Re-encrypt the vault with a new unlock key
  doctor    Compare env usage in code with checked-in examples
`);
}
