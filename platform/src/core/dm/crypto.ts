import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { MessageBody, MessageHeader } from './types';

/* Message integrity with ECDSA over NIST P-256 and SHA-256, using the audited noble-curves library
   (the same curve family used by IEEE 1609.2 and ETSI ITS security). Signatures are deterministic
   (RFC 6979), so a replay of the simulation produces byte-identical messages.
   The demo keys are derived from fixed labels so the run is reproducible; they are NOT a real PKI
   and must never be used outside this simulation. */

/** Stable JSON: object keys sorted at every level, no whitespace. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

export function signedBytes(header: MessageHeader, body: MessageBody): Uint8Array {
  return utf8ToBytes(canonical({ header, body }));
}

export function digestHex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export interface KeyPair {
  keyId: string;
  secretKey: Uint8Array;
  publicKeyHex: string;
}

const keyCache = new Map<string, KeyPair>();

/** Deterministic demo key for a simulated issuer. */
export function demoKey(label: string): KeyPair {
  const hit = keyCache.get(label);
  if (hit) return hit;
  const need = p256.lengths.seed ?? 48;
  const seed = new Uint8Array(need);
  let block = sha256(utf8ToBytes(`digital-marshal-demo-key:${label}`));
  for (let i = 0; i < need; i++) {
    if (i > 0 && i % 32 === 0) block = sha256(block);
    seed[i] = block[i % 32];
  }
  const { secretKey, publicKey } = p256.keygen(seed);
  const kp = { keyId: `${label}#1`, secretKey, publicKeyHex: bytesToHex(publicKey) };
  keyCache.set(label, kp);
  return kp;
}

export function sign(bytes: Uint8Array, key: KeyPair): string {
  return bytesToHex(p256.sign(bytes, key.secretKey));
}

const verifyCache = new Map<string, boolean>();

/**
 * Verify a signature. Every receiving vehicle runs this same check on the same bytes; the result is a
 * pure function of (bytes, signature, public key), so identical checks are computed once and reused.
 */
export function verify(bytes: Uint8Array, sigHex: string, publicKeyHex: string): boolean {
  const key = `${digestHex(bytes)}|${sigHex}|${publicKeyHex}`;
  const hit = verifyCache.get(key);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    ok = p256.verify(hexToBytes(sigHex), bytes, hexToBytes(publicKeyHex));
  } catch {
    ok = false;
  }
  if (verifyCache.size > 20000) verifyCache.clear();
  verifyCache.set(key, ok);
  return ok;
}
