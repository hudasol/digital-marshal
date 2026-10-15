import type { Network } from '../network/types';
import { canonical, digestHex, signedBytes, verify } from './crypto';
import { TRUST_STORE } from './trust';
import type { CheckResult, MessageType, ReasonCode, SignedMessage, Verdict } from './types';
import { utf8ToBytes } from '@noble/hashes/utils.js';

/* Message validation, run by the coordination node on everything it ingests and by every vehicle
   adapter on everything it receives. Checks run in a fixed order and stop at the first failure; the
   verdict lists each check with what was evaluated, so a rejection always has a specific reason. */

/** How old a message may be before it is treated as stale, s. Issuers re-sign active messages well within this. */
export const MAX_AGE: Record<MessageType, number> = {
  SIGNAL_OUTAGE: 180,
  SIGNAL_RESTORED: 180,
  ROAD_RESTRICTION: 180,
  RESTRICTION_LIFTED: 180,
  EMERGENCY_CORRIDOR: 30,
  CORRIDOR_CLEARED: 60,
  ASSISTANCE_AUTHORIZATION: 600,
  ROUTE_ADVISORY: 60,
};
const CLOCK_SKEW = 2;

export interface ValidationCtx {
  now: number;
  net: Network;
  /** message ids already processed by this receiver */
  seen(msgId: string): boolean;
  /** the receiver's current accepted version of an incident and the digest of its body */
  current(incidentId: string): { version: number; bodyDigest: string } | null;
}

export function bodyDigest(m: SignedMessage): string {
  return digestHex(utf8ToBytes(canonical(m.body)));
}

/** Message types that describe the incident's current condition and are ordered by version. */
export const STATE_TYPES: MessageType[] = [
  'SIGNAL_OUTAGE',
  'SIGNAL_RESTORED',
  'ROAD_RESTRICTION',
  'RESTRICTION_LIFTED',
  'EMERGENCY_CORRIDOR',
  'CORRIDOR_CLEARED',
];

const TYPES: MessageType[] = [
  'SIGNAL_OUTAGE',
  'SIGNAL_RESTORED',
  'ROAD_RESTRICTION',
  'RESTRICTION_LIFTED',
  'EMERGENCY_CORRIDOR',
  'CORRIDOR_CLEARED',
  'ASSISTANCE_AUTHORIZATION',
  'ROUTE_ADVISORY',
];

export function validate(m: SignedMessage, ctx: ValidationCtx): Verdict {
  const checks: CheckResult[] = [];
  const fail = (code: ReasonCode, name: string, detail: string, status: Verdict['status'] = 'rejected'): Verdict => {
    checks.push({ name, pass: false, detail });
    return { status, code, checks };
  };
  const pass = (name: string, detail: string) => checks.push({ name, pass: true, detail });

  // 1. structure
  const h = m?.header;
  const b = m?.body;
  if (
    !h ||
    !b ||
    !m.sig ||
    typeof h.msgId !== 'string' ||
    typeof h.incidentId !== 'string' ||
    typeof h.version !== 'number' ||
    typeof h.issuedAt !== 'number' ||
    typeof h.validUntil !== 'number' ||
    !TYPES.includes(b.type)
  ) {
    return fail('SCHEMA_INVALID', 'Structure', 'Required fields missing or of the wrong type');
  }
  pass('Structure', `${b.type} v${h.version} for ${h.incidentId}`);

  // 2. duplicates are ignored, not errors
  if (ctx.seen(h.msgId)) return fail('DUPLICATE', 'Replay / duplicate', `Message ${h.msgId} already processed`, 'duplicate');
  pass('Replay / duplicate', 'Not seen before');

  // 3. map version
  if (h.mapVersion !== ctx.net.version) {
    return fail('MAP_VERSION_MISMATCH', 'Map version', `Message refers to map ${h.mapVersion}, receiver uses ${ctx.net.version}`);
  }
  pass('Map version', h.mapVersion);

  // 4. issuer and certificate
  const issuer = TRUST_STORE[h.issuer];
  if (!issuer) return fail('UNKNOWN_ISSUER', 'Issuer', `${h.issuer} is not in the trust store`);
  if (ctx.now > issuer.validTo || ctx.now < issuer.validFrom) {
    return fail('CERT_EXPIRED', 'Issuer', `Certificate of ${h.issuer} is not valid at this time`);
  }
  pass('Issuer', `${issuer.name}`);

  // 5. integrity and origin
  const bytes = signedBytes(h, b);
  if (m.sig.keyId !== issuer.keyId || !verify(bytes, m.sig.value, issuer.publicKeyHex)) {
    return fail('BAD_SIGNATURE', 'Signature', `ECDSA P-256 over ${bytes.length} bytes does not verify with ${issuer.keyId}`);
  }
  pass('Signature', `ECDSA P-256 over ${bytes.length} bytes verified with ${issuer.keyId} (proves origin and integrity, not physical truth)`);

  // 6. permission for this message type
  if (!issuer.permissions.includes(b.type)) {
    return fail('NOT_PERMITTED', 'Permission', `${h.issuer} may not issue ${b.type}`);
  }
  pass('Permission', `${h.issuer} may issue ${b.type}`);

  // 7. location exists and lies within the issuer's scope
  const links = [...(b.area.links ?? []), ...(b.area.lanes ?? []).map((x) => x.link)];
  const junctions = b.area.junctions ?? [];
  const unknown = [...links.filter((l) => !ctx.net.links[l]), ...junctions.filter((j) => !ctx.net.junctions[j])];
  if (unknown.length) return fail('UNKNOWN_LOCATION', 'Location', `Not on the map: ${unknown.join(', ')}`);
  for (const ln of b.area.lanes ?? []) {
    const l = ctx.net.links[ln.link];
    if (ln.lanes.some((k) => k < 0 || k >= l.lanes) || ln.s0 < 0 || ln.s1 > l.length + 1 || ln.s1 <= ln.s0) {
      return fail('UNKNOWN_LOCATION', 'Location', `Lane or extent outside ${ln.link}`);
    }
  }
  if (!('district' in issuer.scope)) {
    const sc = issuer.scope;
    const outside = [...links.filter((l) => !sc.links.includes(l)), ...junctions.filter((j) => !sc.junctions.includes(j))];
    if (outside.length) return fail('OUT_OF_SCOPE', 'Scope', `${h.issuer} is not authorised for ${outside.join(', ')}`);
  }
  pass('Location and scope', [...junctions, ...links].join(', ') || 'district');

  // 8. time: not from the future, within validity, not stale
  if (h.issuedAt > ctx.now + CLOCK_SKEW) return fail('FUTURE_TIMESTAMP', 'Freshness', `Issued ${(h.issuedAt - ctx.now).toFixed(0)} s in the future`);
  if (ctx.now < h.validFrom - CLOCK_SKEW) return fail('NOT_YET_VALID', 'Validity', `Valid from ${h.validFrom.toFixed(0)} s`);
  if (ctx.now > h.validUntil) return fail('EXPIRED', 'Validity', `Expired ${(ctx.now - h.validUntil).toFixed(0)} s ago`);
  const age = ctx.now - h.issuedAt;
  if (age > MAX_AGE[b.type]) return fail('STALE', 'Freshness', `Issued ${age.toFixed(0)} s ago; maximum age for ${b.type} is ${MAX_AGE[b.type]} s`);
  pass('Time', `Issued ${age.toFixed(1)} s ago, valid ${(h.validUntil - ctx.now).toFixed(0)} s more`);

  // 9. version ordering per incident. Only messages that state the incident's condition are
  // versioned; advice and authorisations are separate streams (unique ids, own freshness rules).
  const cur = STATE_TYPES.includes(b.type) ? ctx.current(h.incidentId) : null;
  if (cur) {
    if (h.version < cur.version) {
      return fail('OUTDATED_VERSION', 'Version', `v${h.version} is older than the accepted v${cur.version}`);
    }
    if (h.version === cur.version && bodyDigest(m) !== cur.bodyDigest) {
      return fail('CONFLICTING_UPDATE', 'Version', `Same version v${h.version} with different content: flagged, not applied`, 'flagged');
    }
  }
  pass('Version', cur ? `v${h.version} (accepted v${cur.version})` : `first version seen: v${h.version}`);
  return { status: 'accepted', code: 'ACCEPTED', checks };
}
