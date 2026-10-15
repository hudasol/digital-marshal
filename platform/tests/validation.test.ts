import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../src/core/network/build';
import { signedBytes, sign, demoKey } from '../src/core/dm/crypto';
import { validate, bodyDigest, type ValidationCtx } from '../src/core/dm/validate';
import type { MessageBody, MessageHeader, SignedMessage } from '../src/core/dm/types';

const net = buildNetwork();

function make(issuer: string, over: Partial<MessageHeader> = {}, body: Partial<MessageBody> = {}, keyLabel = issuer): SignedMessage {
  const header: MessageHeader = {
    msgId: `M-${Math.random().toString(36).slice(2, 10)}`,
    incidentId: 'INC-0001',
    version: 1,
    issuer,
    issuedAt: 100,
    validFrom: 100,
    validUntil: 1000,
    mapVersion: net.version,
    ...over,
  };
  const b: MessageBody = {
    type: 'SIGNAL_OUTAGE',
    severity: 4,
    area: { junctions: ['J6', 'J7'] },
    detail: { restriction: 'uncontrolled_junction' },
    text: 'Signals dark at J6, J7',
    ...body,
  };
  const key = demoKey(keyLabel);
  return { header, body: b, sig: { alg: 'ECDSA-P256-SHA256', keyId: key.keyId, value: sign(signedBytes(header, b), key) }, origin: 'injected' };
}

function ctx(over: Partial<ValidationCtx> = {}): ValidationCtx {
  return { now: 110, net, seen: () => false, current: () => null, ...over };
}

describe('message validation', () => {
  it('accepts a correctly signed, authorised, fresh message and says what the signature proves', () => {
    const v = validate(make('DM-TMC'), ctx());
    expect(v.status).toBe('accepted');
    expect(v.checks.find((c) => c.name === 'Signature')?.detail).toContain('not physical truth');
  });

  it('rejects tampered content (signature no longer verifies)', () => {
    const m = make('DM-TMC');
    m.body.area = { junctions: ['J6', 'J7', 'J8'] };
    expect(validate(m, ctx()).code).toBe('BAD_SIGNATURE');
  });

  it('rejects an issuer that is not in the trust store, even with a valid signature of its own', () => {
    expect(validate(make('ROGUE-77'), ctx()).code).toBe('UNKNOWN_ISSUER');
  });

  it('rejects a message signed with a key that is not the claimed issuer', () => {
    expect(validate(make('DM-TMC', {}, {}, 'ROGUE-77'), ctx()).code).toBe('BAD_SIGNATURE');
  });

  it('rejects a known issuer acting outside its permissions', () => {
    // a works contractor may not declare signal outages
    const m = make('WORKS-C07', {}, { area: { links: ['J3>J7'] } });
    expect(validate(m, ctx()).code).toBe('NOT_PERMITTED');
  });

  it('rejects a contractor restriction outside its permitted location', () => {
    const m = make('WORKS-C07', {}, { type: 'ROAD_RESTRICTION', area: { links: ['J10>J11'] } });
    expect(validate(m, ctx()).code).toBe('OUT_OF_SCOPE');
  });

  it('rejects locations that do not exist on the map in use', () => {
    expect(validate(make('DM-TMC', {}, { area: { junctions: ['J99'] } }), ctx()).code).toBe('UNKNOWN_LOCATION');
    expect(validate(make('DM-TMC', { mapVersion: 'DMD-0.0' }), ctx()).code).toBe('MAP_VERSION_MISMATCH');
  });

  it('rejects expired, stale and future-dated messages', () => {
    expect(validate(make('DM-TMC', { validUntil: 105 }), ctx()).code).toBe('EXPIRED');
    expect(validate(make('DM-TMC', { issuedAt: 100 - 400 }), ctx()).code).toBe('STALE');
    expect(validate(make('DM-TMC', { issuedAt: 200 }), ctx()).code).toBe('FUTURE_TIMESTAMP');
  });

  it('rejects a lapsed certificate', () => {
    expect(validate(make('DM-TMC-2025'), ctx()).code).toBe('CERT_EXPIRED');
  });

  it('orders versions: older is rejected, same version with different content is flagged', () => {
    const accepted = make('DM-TMC', { version: 3 });
    const cur = { version: 3, bodyDigest: bodyDigest(accepted) };
    expect(validate(make('DM-TMC', { version: 2 }), ctx({ current: () => cur })).code).toBe('OUTDATED_VERSION');
    const conflicting = make('DM-TMC', { version: 3 }, { area: { junctions: ['J6'] } });
    const v = validate(conflicting, ctx({ current: () => cur }));
    expect(v.status).toBe('flagged');
    expect(v.code).toBe('CONFLICTING_UPDATE');
    // a re-signed refresh with identical content is accepted
    const refresh = make('DM-TMC', { version: 3, issuedAt: 105 });
    expect(validate(refresh, ctx({ current: () => cur })).status).toBe('accepted');
  });

  it('does not treat advice or authorisations for the same incident as conflicting versions', () => {
    const outage = make('DM-TMC', { version: 1 });
    const cur = { version: 1, bodyDigest: bodyDigest(outage) };
    const advice = make('DM-TMC', { version: 1 }, { type: 'ROUTE_ADVISORY', detail: { assignments: ['AV-0001|J6>J7'] } });
    expect(validate(advice, ctx({ current: () => cur })).status).toBe('accepted');
    const auth = make('FLEET-RA', { version: 1 }, { type: 'ASSISTANCE_AUTHORIZATION', detail: { junction: 'J7' } });
    expect(validate(auth, ctx({ current: () => cur })).status).toBe('accepted');
  });

  it('ignores duplicates without treating them as errors', () => {
    const m = make('DM-TMC');
    expect(validate(m, ctx({ seen: (id) => id === m.header.msgId })).status).toBe('duplicate');
  });
});
