# Changelog

All notable changes to this project will be documented in this file.

This project follows conventional commit style for commit messages.

## 0.1.0 - 2026-05-08

### Added

- Project-local `.envkeyring/` vault initialization.
- Monorepo-aware `.env` discovery from the repository root.
- `seal` command to encrypt `.env` values and generate `.env.example` files.
- `unlock` command to restore sealed `.env` files.
- `status` command for vault and env file state.
- `verify` command to check an unlock key without writing files.
- `list` command to inspect sealed env file paths and variable names without printing values.
- `rotate-key` command to re-encrypt the vault with a new unlock key.
- `doctor` command to compare env usage in code with committed examples.
- Interactive `seal --interactive` checklist powered by Ink.
- GitHub Actions CI for Node.js 20, 22, and 24.
- Smoke coverage for success flows, wrong keys, scoped unlock, overwrite behavior, and secret redaction.

### Security

- Vault encryption uses `scrypt` key derivation and `AES-256-GCM` authenticated encryption through Node.js `crypto`.
- Generated `.env.example` files use `<encrypted>` placeholders instead of real values.
