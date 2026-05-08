import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "envkeyring-"));
const cli = path.resolve("dist/cli.js");

function run(args, input = "") {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    input,
    encoding: "utf8"
  });

  assert.equal(
    result.status,
    0,
    `${args.join(" ")} failed\nERROR:\n${result.error?.stack ?? "none"}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
  return result;
}

function runFail(args, input = "") {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    input,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0, `${args.join(" ")} unexpectedly succeeded\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
}

fs.mkdirSync(path.join(root, "apps/web"), { recursive: true });
fs.mkdirSync(path.join(root, "apps/api"), { recursive: true });
fs.writeFileSync(path.join(root, "apps/web/.env"), "PUBLIC_URL=http://localhost:3000\nWEB_SECRET=web-value\n");
fs.writeFileSync(path.join(root, "apps/web/.env.local"), "LOCAL_ONLY=do-not-seal\n");
fs.writeFileSync(path.join(root, "apps/api/.env"), "DATABASE_URL=postgres://local\nJWT_SECRET=jwt-value\n");
fs.writeFileSync(path.join(root, "apps/api/server.ts"), "console.log(process.env.DATABASE_URL, process.env.MISSING_FROM_EXAMPLE);\n");
fs.writeFileSync(path.join(root, ".env.local"), "ROOT_SECRET=root-value\n");
fs.writeFileSync(path.join(root, ".gitignore"), ".env*\nnode_modules\n");

const initOutput = run(["init"]);
assert.match(initOutput.stdout, /\.envkeyring\/ may not be commit-ready/);

const gitignoreStatusBefore = run(["gitignore"]);
assert.match(gitignoreStatusBefore.stdout, /\.envkeyring: needs fix/);
assert.match(gitignoreStatusBefore.stdout, /!\.envkeyring\//);

const gitignoreFix = run(["gitignore", "fix"]);
assert.match(gitignoreFix.stdout, /Updated \.gitignore/);
assert.match(gitignoreFix.stdout, /\.envkeyring: allowed/);
const gitignoreContent = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
assert.match(gitignoreContent, /!\.envkeyring\//);
assert.match(gitignoreContent, /\.envkeyring\/vault\.enc\.json/);
assert.match(gitignoreContent, /\.envkeyring\/admin\.private\.pem/);

const configPath = path.join(root, ".envkeyring/config.json");
const legacyConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
legacyConfig.include = ["**/.env", "**/.env.*"];
legacyConfig.exclude = [
  "**/.env.example",
  "**/.env.*.example",
  "**/.env.sample",
  "**/.env.*.sample",
  "**/.env.template",
  "**/.env.*.template"
];
fs.writeFileSync(configPath, `${JSON.stringify(legacyConfig, null, 2)}\n`);

const upgradeOutput = run(["config", "upgrade"]);
assert.match(upgradeOutput.stdout, /Upgraded config with 2 include patterns and 6 exclude patterns/);

const adminInit = run(["admin", "init"]);
assert.match(adminInit.stdout, /Initialized admin signing key/);
assert.ok(fs.existsSync(path.join(root, ".envkeyring/admin.private.pem")));
assert.match(fs.readFileSync(path.join(root, ".envkeyring/.gitignore"), "utf8"), /admin\.private\.pem/);

const configOutput = run(["config", "add-exclude", "**/.env.local"]);
assert.match(configOutput.stdout, /Added exclude pattern \*\*\/\.env\.local/);

const beforeSealStatus = run(["status"]);
assert.match(beforeSealStatus.stdout, /Initialized: yes/);
assert.match(beforeSealStatus.stdout, /missing example/);
assert.match(beforeSealStatus.stdout, /Exclude: .*\.env\.local/);

run(["seal"], "supersecret\nsupersecret\n");

assert.ok(fs.existsSync(path.join(root, ".envkeyring/vault.enc.json")));
assert.ok(fs.existsSync(path.join(root, ".envkeyring/vault.meta.json")));
const firstMeta = JSON.parse(fs.readFileSync(path.join(root, ".envkeyring/vault.meta.json"), "utf8"));
assert.equal(firstMeta.revision, 1);
assert.equal(firstMeta.signature.algorithm, "ed25519");
assert.deepEqual(firstMeta.changes.addedFiles, [".env.local", "apps/api/.env", "apps/web/.env"]);
assert.equal(fs.readFileSync(path.join(root, ".env.local.example"), "utf8"), "ROOT_SECRET=<encrypted>\n");
assert.equal(fs.readFileSync(path.join(root, "apps/web/.env.example"), "utf8"), "PUBLIC_URL=<encrypted>\nWEB_SECRET=<encrypted>\n");
assert.equal(fs.readFileSync(path.join(root, "apps/api/.env.example"), "utf8"), "DATABASE_URL=<encrypted>\nJWT_SECRET=<encrypted>\n");
assert.equal(fs.existsSync(path.join(root, "apps/web/.env.local.example")), false);

const duplicateSeal = runFail(["seal"]);
assert.match(duplicateSeal.stderr, /Vault already exists/);

fs.appendFileSync(path.join(root, "apps/web/.env"), "NEXT_PUBLIC_EXTRA=extra-value\n");
run(["reseal"], "supersecret2\nsupersecret2\n");
const secondMeta = JSON.parse(fs.readFileSync(path.join(root, ".envkeyring/vault.meta.json"), "utf8"));
assert.equal(secondMeta.revision, 2);
assert.deepEqual(secondMeta.changes.addedKeys["apps/web/.env"], ["NEXT_PUBLIC_EXTRA"]);

const afterSealStatus = run(["status"]);
assert.match(afterSealStatus.stdout, /Vault: \.envkeyring\/vault\.enc\.json/);
assert.match(afterSealStatus.stdout, /Revision: 2/);
assert.match(afterSealStatus.stdout, /Signature: valid/);
assert.match(afterSealStatus.stdout, /example ok/);

fs.rmSync(path.join(root, "apps/web/.env"));
fs.rmSync(path.join(root, "apps/api/.env"));
fs.rmSync(path.join(root, ".env.local"));

run(["rotate-key"], "supersecret2\nnewsecret\nnewsecret\n");

const wrongVerify = runFail(["verify"], "wrongsecret\n");
assert.match(wrongVerify.stderr, /envkeyring:/);

const verify = run(["verify"], "newsecret\n");
assert.match(verify.stdout, /Unlock key verified for 3 sealed env files/);
assert.match(verify.stdout, /apps\/api\/\.env/);

const list = run(["list", "apps/api"], "newsecret\n");
assert.match(list.stdout, /Vault contains 1 sealed env file/);
assert.match(list.stdout, /DATABASE_URL/);
assert.match(list.stdout, /JWT_SECRET/);
assert.doesNotMatch(list.stdout, /jwt-value/);

fs.writeFileSync(path.join(root, "apps/api/.env"), "DATABASE_URL=local-override\nJWT_SECRET=local-override\n");

const scopedUnlock = run(["unlock", "apps/web"], "newsecret\n");
assert.match(scopedUnlock.stdout, /Wrote apps\/web\/\.env/);
assert.doesNotMatch(scopedUnlock.stdout, /apps\/api\/\.env/);
assert.match(fs.readFileSync(path.join(root, "apps/web/.env"), "utf8"), /WEB_SECRET=web-value/);
assert.match(fs.readFileSync(path.join(root, "apps/api/.env"), "utf8"), /local-override/);

const skippedUnlock = run(["unlock"], "newsecret\n");
assert.match(skippedUnlock.stdout, /Skipped existing apps\/api\/\.env/);
assert.match(skippedUnlock.stdout, /Skipped existing apps\/web\/\.env/);
assert.match(fs.readFileSync(path.join(root, "apps/api/.env"), "utf8"), /local-override/);

const forceUnlock = run(["unlock", "--force"], "newsecret\n");
assert.match(forceUnlock.stdout, /Wrote \.env\.local/);
assert.match(forceUnlock.stdout, /Wrote apps\/api\/\.env/);
assert.match(forceUnlock.stdout, /Wrote apps\/web\/\.env/);

assert.match(fs.readFileSync(path.join(root, ".env.local"), "utf8"), /ROOT_SECRET=root-value/);
assert.match(fs.readFileSync(path.join(root, "apps/web/.env"), "utf8"), /WEB_SECRET=web-value/);
assert.match(fs.readFileSync(path.join(root, "apps/web/.env"), "utf8"), /NEXT_PUBLIC_EXTRA=extra-value/);
assert.match(fs.readFileSync(path.join(root, "apps/api/.env"), "utf8"), /DATABASE_URL=postgres:\/\/local/);

const doctor = run(["doctor"]);
assert.match(doctor.stdout, /MISSING_FROM_EXAMPLE/);

fs.rmSync(root, { recursive: true, force: true });
