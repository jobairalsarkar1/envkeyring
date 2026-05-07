import crypto from "node:crypto";
import { VAULT_VERSION } from "./constants.js";
import type { VaultEnvelope, VaultPayload } from "./types.js";

export function encryptVault(payload: VaultPayload, passphrase: string): VaultEnvelope {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: VAULT_VERSION,
    cipher: "aes-256-gcm",
    kdf: {
      name: "scrypt",
      salt: salt.toString("base64"),
      keyLength: 32
    },
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

export function decryptVault(envelope: VaultEnvelope, passphrase: string): VaultPayload {
  if (envelope.version !== VAULT_VERSION || envelope.cipher !== "aes-256-gcm") {
    throw new Error("Unsupported vault format.");
  }

  const salt = Buffer.from(envelope.kdf.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const key = crypto.scryptSync(passphrase, salt, envelope.kdf.keyLength);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as VaultPayload;
}
