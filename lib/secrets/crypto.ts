/**
 * Encryption for exchange API secrets at rest (spec E7): AES-256-GCM with a 32-byte master key from
 * EXCHANGE_KEY_SECRET (base64). Format: `v1:<iv>:<tag>:<ciphertext>` (base64 parts). Tampering or a wrong
 * key fails the auth tag check. Without a valid master key every exchange feature is off (fail closed).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const KEY_VERSION = 1;

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsError";
  }
}

export function masterKey(env: string | undefined = process.env.EXCHANGE_KEY_SECRET): Buffer | null {
  if (!env?.trim()) return null;
  const key = Buffer.from(env.trim(), "base64");
  return key.length === 32 ? key : null;
}

export const secretsConfigured = () => masterKey() != null;

function requireKey(key?: Buffer | null) {
  const k = key ?? masterKey();
  if (!k) throw new SecretsError("EXCHANGE_KEY_SECRET is missing or not 32 bytes of base64 — exchange connections are disabled");
  return k;
}

export function encryptSecret(plain: string, key?: Buffer | null): string {
  const k = requireKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v${KEY_VERSION}:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(stored: string, key?: Buffer | null): string {
  const k = requireKey(key);
  const [v, iv, tag, ct] = stored.split(":");
  if (v !== `v${KEY_VERSION}` || !iv || !tag || ct === undefined) throw new SecretsError("Unsupported secret format");
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new SecretsError("Secret could not be decrypted (wrong EXCHANGE_KEY_SECRET or tampered data)");
  }
}

export const last4 = (s: string) => s.trim().slice(-4);
