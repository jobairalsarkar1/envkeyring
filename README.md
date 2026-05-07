# envkeyring

[![CI](https://github.com/jobairalsarkar1/envkeyring/actions/workflows/ci.yml/badge.svg)](https://github.com/jobairalsarkar1/envkeyring/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/envkeyring.svg)](https://www.npmjs.com/package/envkeyring)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

`envkeyring` is a git-like encrypted `.env` handoff tool for teams and monorepos.

Admins seal real `.env` values into a project-local encrypted vault. Teammates clone the repo, receive the unlock key through whatever channel the team chooses, and restore the same `.env` files locally.

## Why

Teams often commit `.env.example`, but the real values still have to be copied manually from an admin to each developer. `envkeyring` keeps the variable names visible and commit-friendly while storing the real values in an encrypted vault.

## Install

```bash
npm install -D envkeyring
```

You can run the CLI with either command:

```bash
npx envkeyring help
npx ekr help
```

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
apps/web/.env.example
apps/api/.env.example
```

Generated examples use placeholders:

```env
DATABASE_URL=<encrypted>
JWT_SECRET=<encrypted>
```

Commit `.envkeyring/` and the generated `.env.example` files. Do not commit real `.env` files.

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
npx envkeyring list apps/api
npx envkeyring unlock apps/web
npx envkeyring doctor packages/worker
```

## Commands

```bash
npx envkeyring init
```

Creates the project-local `.envkeyring/` folder.

```bash
npx envkeyring status [path]
```

Shows whether the repo is initialized, whether a vault exists, which `.env` files are discovered, and whether matching examples exist.

```bash
npx envkeyring seal [path]
```

Reads discovered `.env` files, writes matching `.env.example` files, and encrypts the real values into `.envkeyring/vault.enc.json`.

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
```

Commit:

```txt
.envkeyring/config.json
.envkeyring/vault.enc.json
*.env.example
```

## Security Model

The encrypted vault is safe to commit only while the unlock key stays private. Anyone with both the repository and the unlock key can recover the original `.env` values.

This version uses Node's built-in `crypto` module with `scrypt` key derivation and `AES-256-GCM` authenticated encryption.

## Development

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

`prepack` builds `dist/` before packaging. The published package contains `dist/`, `README.md`, `LICENSE`, and `package.json`.
