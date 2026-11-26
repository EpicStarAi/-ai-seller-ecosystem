import "server-only";

import { readFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  let raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw && process.env.INTEGRATION_ENCRYPTION_KEY_FILE) {
    raw = readFileSync(process.env.INTEGRATION_ENCRYPTION_KEY_FILE, "utf8").trim();
  }
  if (!raw) throw new Error("Integration encryption key is not configured");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("Integration encryption key must be 32 bytes");
  return key;
}

function fromBytea(value: string): Buffer {
  return value.startsWith("\\x") ? Buffer.from(value.slice(2), "hex") : Buffer.from(value, "base64");
}

export function encryptIntegrationSecret(secret: string, organizationId: string, provider: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${organizationId}:${provider}:v1`));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const packed = Buffer.concat([cipher.getAuthTag(), encrypted]);
  return {
    nonce: `\\x${iv.toString("hex")}`,
    ciphertext: `\\x${packed.toString("hex")}`,
  };
}

export function decryptIntegrationSecret(
  nonceValue: string,
  ciphertextValue: string,
  organizationId: string,
  provider: string,
): string {
  const iv = fromBytea(nonceValue);
  const packed = fromBytea(ciphertextValue);
  if (iv.length !== 12 || packed.length < 17) throw new Error("Stored credential is malformed");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAAD(Buffer.from(`${organizationId}:${provider}:v1`));
  decipher.setAuthTag(packed.subarray(0, 16));
  return Buffer.concat([decipher.update(packed.subarray(16)), decipher.final()]).toString("utf8");
}
