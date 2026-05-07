# envkeyring

`envkeyring` is a git-like encrypted `.env` handoff tool for teams and monorepos.

Admins keep the real `.env` values locally, seal them into an encrypted project vault, and commit the generated `.env.example` files plus `.envkeyring/`. Other developers unlock the vault with the key shared by the admin.

## MVP workflow

```bash
npm install -D envkeyring
npx envkeyring init
npx envkeyring status
npx envkeyring seal
```

That creates:

```txt
.envkeyring/
  config.json
  vault.enc.json
apps/web/.env.example
apps/api/.env.example
```

A teammate can then run:

```bash
npx envkeyring verify
npx envkeyring unlock
```

By default, `unlock` skips existing `.env` files. Use `--force` to overwrite:

```bash
npx envkeyring unlock --force
```

Admins can rotate the shared unlock key without needing local `.env` files:

```bash
npx envkeyring rotate-key
```

## Monorepos

Run commands from anywhere inside the repo. `envkeyring` walks upward until it finds `.envkeyring/`, then keeps all env file paths relative to that root.

```bash
npx envkeyring status apps/api
npx envkeyring seal apps/api
npx envkeyring unlock apps/web
npx envkeyring doctor packages/worker
```

## Doctor

```bash
npx envkeyring doctor
```

The doctor command scans common env usages such as `process.env.KEY`, `import.meta.env.KEY`, `Deno.env.get("KEY")`, `os.getenv("KEY")`, and `getenv("KEY")`, then compares those keys with committed `.env*.example` files.

## Security model

The encrypted vault is safe to commit only while the unlock key stays private. Anyone with the repository and the unlock key can recover the original `.env` values.

This first version uses Node's built-in `crypto` module with `scrypt` key derivation and `AES-256-GCM` authenticated encryption.
