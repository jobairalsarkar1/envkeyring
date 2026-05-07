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

fs.mkdirSync(path.join(root, "apps/web"), { recursive: true });
fs.mkdirSync(path.join(root, "apps/api"), { recursive: true });
fs.writeFileSync(path.join(root, "apps/web/.env"), "PUBLIC_URL=http://localhost:3000\nWEB_SECRET=web-value\n");
fs.writeFileSync(path.join(root, "apps/api/.env"), "DATABASE_URL=postgres://local\nJWT_SECRET=jwt-value\n");
fs.writeFileSync(path.join(root, "apps/api/server.ts"), "console.log(process.env.DATABASE_URL, process.env.MISSING_FROM_EXAMPLE);\n");

run(["init"]);
const beforeSealStatus = run(["status"]);
assert.match(beforeSealStatus.stdout, /Initialized: yes/);
assert.match(beforeSealStatus.stdout, /missing example/);

run(["seal"], "supersecret\nsupersecret\n");

assert.ok(fs.existsSync(path.join(root, ".envkeyring/vault.enc.json")));
assert.equal(fs.readFileSync(path.join(root, "apps/web/.env.example"), "utf8"), "PUBLIC_URL=<encrypted>\nWEB_SECRET=<encrypted>\n");
assert.equal(fs.readFileSync(path.join(root, "apps/api/.env.example"), "utf8"), "DATABASE_URL=<encrypted>\nJWT_SECRET=<encrypted>\n");

const afterSealStatus = run(["status"]);
assert.match(afterSealStatus.stdout, /Vault: \.envkeyring\/vault\.enc\.json/);
assert.match(afterSealStatus.stdout, /example ok/);

fs.rmSync(path.join(root, "apps/web/.env"));
fs.rmSync(path.join(root, "apps/api/.env"));

run(["unlock"], "supersecret\n");

assert.match(fs.readFileSync(path.join(root, "apps/web/.env"), "utf8"), /WEB_SECRET=web-value/);
assert.match(fs.readFileSync(path.join(root, "apps/api/.env"), "utf8"), /DATABASE_URL=postgres:\/\/local/);

const doctor = run(["doctor"]);
assert.match(doctor.stdout, /MISSING_FROM_EXAMPLE/);

fs.rmSync(root, { recursive: true, force: true });
