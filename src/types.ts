export type EnvEntry = {
  key: string;
  value: string;
};

export type VaultEnvFile = {
  path: string;
  entries: EnvEntry[];
};

export type VaultPayload = {
  version: 1;
  sealedAt: string;
  files: VaultEnvFile[];
};

export type VaultMetaFile = {
  path: string;
  keys: string[];
};

export type VaultMetaChanges = {
  addedFiles: string[];
  removedFiles: string[];
  addedKeys: Record<string, string[]>;
  removedKeys: Record<string, string[]>;
};

export type VaultMetadata = {
  version: 1;
  revision: number;
  sealedAt: string;
  sealedBy: string;
  files: VaultMetaFile[];
  changes: VaultMetaChanges;
};

export type VaultEnvelope = {
  version: 1;
  cipher: "aes-256-gcm";
  kdf: {
    name: "scrypt";
    salt: string;
    keyLength: 32;
  };
  iv: string;
  tag: string;
  ciphertext: string;
};

export type EnvKeyringConfig = {
  version: 1;
  createdAt: string;
  vaultFile: string;
  include: string[];
  exclude: string[];
};
