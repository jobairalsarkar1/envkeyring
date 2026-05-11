# envkeyring

[![CI](https://github.com/jobairalsarkar1/envkeyring/actions/workflows/ci.yml/badge.svg)](https://github.com/jobairalsarkar1/envkeyring/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/envkeyring.svg)](https://www.npmjs.com/package/envkeyring)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

`envkeyring` is a git-like encrypted `.env` handoff tool for teams and monorepos.

Admins seal real `.env` values into a project-local encrypted vault. Teammates clone the repo, receive the unlock key through whatever channel the team chooses, and restore the same `.env` files locally.

## Why

Teams often commit `.env.example`, but the real values still have to be copied manually from an admin to each developer. `envkeyring` keeps the variable names visible and commit-friendly while storing the real values in an encrypted vault.

## Install

Recommended for one-off use:

```bash
npx --yes envkeyring@latest help
```

Recommended for a project:

```bash
npm install -D envkeyring
```

You can run the CLI with either command:

```bash
npx envkeyring help
npx ekr help
```

Global installation is optional. On Linux, `npm install -g envkeyring` may fail with `EACCES` if npm's global directory is owned by root. Prefer `npx`, a project-local dev dependency, or a user-owned Node install through tools like `nvm` or `fnm` instead of using `sudo`.

## Admin Workflow

Start from a repo that already has one or more `.env` files:

```txt
apps/web/.env
apps/api/.env
```

Initialize `envkeyring`:

```bash
npx envkeyring init
```

Optionally initialize admin signing before the first seal:

```bash
npx envkeyring admin init
```

This stores a public signing key in `.envkeyring/config.json` and a private signing key at `.envkeyring/admin.private.pem`. The private key is ignored by `.envkeyring/.gitignore`; keep it private and backed up.

Check what will be managed:

```bash
npx envkeyring status
```

Seal the env files:

```bash
npx envkeyring seal
```

For a guided checklist of discovered env files:

```bash
npx envkeyring seal --interactive
```

This creates a project vault and matching examples:

```txt
.envkeyring/
  config.json
  vault.enc.json
  vault.meta.json
apps/web/.env.example
apps/api/.env.example
```

Generated examples use placeholders:

```env
DATABASE_URL=<encrypted>
JWT_SECRET=<encrypted>
```

Commit `.envkeyring/` and the generated `.env.example` files. Do not commit real `.env` files.

Use `seal` for the first vault. To update an existing vault intentionally, use:

```bash
npx envkeyring reseal
```

Each seal/reseal updates `.envkeyring/vault.meta.json` with a revision number, timestamp, local actor name, sealed file paths, variable names, and key-level additions/removals.

If admin signing is configured, seal/reseal also signs the public metadata. `status` reports whether that signature is valid.

## Teammate Workflow

After cloning the repo, verify the unlock key:

```bash
npx envkeyring verify
```

Inspect the sealed files and variable names without printing values:

```bash
npx envkeyring list
```

Restore `.env` files:

```bash
npx envkeyring unlock
```

By default, `unlock` skips existing `.env` files. To overwrite them:

```bash
npx envkeyring unlock --force
```

## Monorepos

Run commands from anywhere inside the repo. `envkeyring` walks upward until it finds `.envkeyring/`, then keeps env file paths relative to that root.

You can scope commands to one app or package:

```bash
npx envkeyring status apps/api
npx envkeyring seal apps/api
npx envkeyring reseal apps/api
npx envkeyring list apps/api
npx envkeyring unlock apps/web
npx envkeyring doctor packages/worker
```

## Discovery Rules

`envkeyring init` creates `.envkeyring/config.json` with default discovery rules:

```json
{
  "include": [".env", ".env.*", "**/.env", "**/.env.*"],
  "exclude": [
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
  ]
}
```

Patterns match repo-relative paths using `*`, `**`, and `?`. Add project-specific exclusions when needed:

```bash
npx envkeyring config add-exclude "**/.env.local"
npx envkeyring config add-exclude "**/.env.test"
npx envkeyring config add-exclude "fixtures/**"
```

You can inspect and edit rules with:

```bash
npx envkeyring config
npx envkeyring config upgrade
npx envkeyring config add-include "apps/**/.env.production"
npx envkeyring config remove-exclude "**/.env.test"
```

Check or fix project `.gitignore` rules with:

```bash
npx envkeyring gitignore
npx envkeyring gitignore fix
```

## Commands

```bash
npx envkeyring init
```

Creates the project-local `.envkeyring/` folder.

```bash
npx envkeyring admin [status]
```

Shows whether admin signing is configured and whether the local private signing key is present.

```bash
npx envkeyring admin init
```

Generates an Ed25519 signing keypair, stores the public key in config, writes the private key to `.envkeyring/admin.private.pem`, and ignores that private key with `.envkeyring/.gitignore`.

```bash
npx envkeyring config [show]
```

Shows active include and exclude discovery rules.

```bash
npx envkeyring config upgrade
```

Adds any missing default discovery patterns to an existing config while preserving custom rules.

```bash
npx envkeyring gitignore [status]
npx envkeyring gitignore fix
```

Checks whether project `.gitignore` rules accidentally ignore `.envkeyring/`. The fix command appends the allow-list needed to commit vault files while keeping real env files and the admin private signing key ignored.

```bash
npx envkeyring config add-include <pattern>
npx envkeyring config add-exclude <pattern>
npx envkeyring config remove-include <pattern>
npx envkeyring config remove-exclude <pattern>
```

Updates `.envkeyring/config.json` discovery rules.

```bash
npx envkeyring status [path]
```

Shows whether the repo is initialized, whether a vault exists, which `.env` files are discovered, and whether matching examples exist.

```bash
npx envkeyring seal [path]
```

Reads discovered `.env` files, writes matching `.env.example` files, encrypts the real values into `.envkeyring/vault.enc.json`, and writes public revision metadata to `.envkeyring/vault.meta.json`.

`seal` refuses to overwrite an existing vault unless `--force` is provided. Prefer `reseal` for intentional vault updates.

Add `--interactive` to choose discovered env files from a terminal checklist.

```bash
npx envkeyring reseal [path]
```

Explicitly updates an existing vault and increments the public metadata revision.

Add `--interactive` to choose discovered env files from a terminal checklist.

```bash
npx envkeyring verify
```

Checks that an unlock key can decrypt the vault without writing `.env` files.

```bash
npx envkeyring list [path]
```

Lists sealed env file paths and variable names without printing values.

```bash
npx envkeyring unlock [path] [--force]
```

Restores sealed `.env` files from the vault. Existing files are skipped unless `--force` is provided.

```bash
npx envkeyring rotate-key
```

Decrypts the existing vault with the current key and re-encrypts it with a new key. Local `.env` files are not required.

```bash
npx envkeyring doctor [path]
```

Scans common env usages such as `process.env.KEY`, `import.meta.env.KEY`, `Deno.env.get("KEY")`, `os.getenv("KEY")`, and `getenv("KEY")`, then compares those keys with committed `.env*.example` files.

## Git Ignore

A typical project using `envkeyring` should ignore real env files:

```gitignore
.env
.env.*
!.env.example
!.env.*.example
!.envkeyring/
!.envkeyring/config.json
!.envkeyring/.gitignore
!.envkeyring/vault.enc.json
!.envkeyring/vault.meta.json
.envkeyring/admin.private.pem
```

`envkeyring init` and `envkeyring status` warn when a broad rule like `.env*` also ignores `.envkeyring/`. Run `npx envkeyring gitignore fix` to append the recommended allow-list automatically.

Commit:

```txt
.envkeyring/config.json
.envkeyring/.gitignore
.envkeyring/vault.enc.json
.envkeyring/vault.meta.json
*.env.example
```

Do not commit:

```txt
.envkeyring/admin.private.pem
```

## Security Model

The encrypted vault is safe to commit only while the unlock key stays private. Anyone with both the repository and the unlock key can recover the original `.env` values.

Admin signing makes unauthorized vault updates visible, not impossible. If signing is configured, the CLI requires `.envkeyring/admin.private.pem` to seal or reseal and signs `vault.meta.json`. Other users can see whether metadata was signed by the configured public key.

For real enforcement, combine admin signing with GitHub branch protection and CODEOWNERS for `.envkeyring/**` and `*.env.example`.

This version uses Node's built-in `crypto` module with `scrypt` key derivation and `AES-256-GCM` authenticated encryption.

## Development

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

`prepack` builds `dist/` before packaging. The published package contains `dist/`, `README.md`, `LICENSE`, and `package.json`.
