import { digestHex, sign, signedBytes } from './crypto';
import { issuerKey } from './trust';
import type { DigitalMarshal } from './service';
import type { Incident, MessageArea, MessageBody, MessageHeader, ReasonCode, SignedMessage } from './types';

/* Security demonstration. Each test builds, from the current situation, a message that a hostile,
   faulty or out-of-date sender could put on the air, and names the one rule it is expected to fail.
   The message is then broadcast like any other and every receiver validates it on its own; the
   interface reports what the node and the vehicles actually decided, not what was expected.

   Several tests are signed with a trusted issuer's key. They stand for a genuine message replayed
   or delayed, a misconfigured sender, or (for the conflicting update) a compromised or faulty
   issuer: cases a valid signature alone cannot catch. */

export type InjectionId =
  | 'tampered'
  | 'forged'
  | 'rogue'
  | 'retired'
  | 'permission'
  | 'scope'
  | 'location'
  | 'map'
  | 'expired'
  | 'stale'
  | 'future'
  | 'outdated'
  | 'conflict';

export interface InjectionSpec {
  id: InjectionId;
  /** the rule it is expected to fail */
  expect: ReasonCode;
  /** issuer named in the header, and the key that actually signs */
  issuer: string;
  signer: string;
  /** needs a live incident whose current version the receivers hold */
  needsIncident: boolean;
}

export const INJECTIONS: InjectionSpec[] = [
  { id: 'tampered', expect: 'BAD_SIGNATURE', issuer: 'DM-TMC', signer: 'DM-TMC', needsIncident: false },
  { id: 'forged', expect: 'BAD_SIGNATURE', issuer: 'DM-TMC', signer: 'ROGUE-77', needsIncident: false },
  { id: 'rogue', expect: 'UNKNOWN_ISSUER', issuer: 'ROGUE-77', signer: 'ROGUE-77', needsIncident: false },
  { id: 'retired', expect: 'CERT_EXPIRED', issuer: 'DM-TMC-2025', signer: 'DM-TMC-2025', needsIncident: false },
  { id: 'permission', expect: 'NOT_PERMITTED', issuer: 'WORKS-C07', signer: 'WORKS-C07', needsIncident: false },
  { id: 'scope', expect: 'OUT_OF_SCOPE', issuer: 'WORKS-C07', signer: 'WORKS-C07', needsIncident: false },
  { id: 'location', expect: 'UNKNOWN_LOCATION', issuer: 'DM-TMC', signer: 'DM-TMC', needsIncident: false },
  { id: 'map', expect: 'MAP_VERSION_MISMATCH', issuer: 'DM-TMC', signer: 'DM-TMC', needsIncident: false },
  { id: 'expired', expect: 'EXPIRED', issuer: 'DM-TMC', signer: 'DM-TMC', needsIncident: false },
  { id: 'stale', expect: 'STALE', issuer: 'DM-TMC', signer: 'DM-TMC', needsIncident: false },
  { id: 'future', expect: 'FUTURE_TIMESTAMP', issuer: 'DM-TMC', signer: 'DM-TMC', needsIncident: false },
  { id: 'outdated', expect: 'OUTDATED_VERSION', issuer: 'DM-TMC', signer: 'DM-TMC', needsIncident: true },
  { id: 'conflict', expect: 'CONFLICTING_UPDATE', issuer: 'DM-TMC', signer: 'DM-TMC', needsIncident: true },
];

/** A false closure of the boulevard eastbound into J7: what a hostile sender would like vehicles to believe. */
const FAKE_LINK = 'J6>J7';

function seal(header: Omit<MessageHeader, 'msgId'>, body: MessageBody, signer: string, test: InjectionId): SignedMessage {
  const h: MessageHeader = { msgId: '', ...header };
  h.msgId = `M-${digestHex(signedBytes(h, body)).slice(0, 10)}`;
  const key = issuerKey(signer);
  return { header: h, body, sig: { alg: 'ECDSA-P256-SHA256', keyId: key.keyId, value: sign(signedBytes(h, body), key) }, origin: 'injected', test };
}

/** The incident a version-based test targets: works first, then an outage, then a corridor. */
function target(dm: DigitalMarshal): { inc: Incident; msg: SignedMessage } | null {
  for (const type of ['roadworks', 'signal_outage', 'emergency_corridor'] as const) {
    const inc = dm.activeIncident(type);
    if (!inc) continue;
    const id = dm.latestIncidentMessage(inc);
    if (id) return { inc, msg: dm.s.messages[id] };
  }
  return null;
}

/** The same kind of content with one meaningful change: other lanes, fewer junctions, a shorter route. */
function altered(body: MessageBody, net: DigitalMarshal['engine']['net']): MessageBody {
  const b = structuredClone(body);
  const lanes = b.area.lanes?.[0];
  if (lanes) {
    const n = net.links[lanes.link].lanes;
    const open = [...Array(n).keys()].filter((k) => !lanes.lanes.includes(k));
    if (open.length) {
      lanes.lanes = open;
      b.text = `Lane ${open.map((k) => k + 1).join(', ')} closed on ${lanes.link}`;
    } else {
      lanes.s1 = Math.round((lanes.s0 + lanes.s1) / 2);
      b.text = `${lanes.link} closed only to ${lanes.s1} m`;
    }
    b.detail = { ...b.detail, lanes: lanes.lanes.join(','), s1: lanes.s1 };
  } else if (b.area.junctions?.length) {
    b.area.junctions = b.area.junctions.length > 1 ? b.area.junctions.slice(0, -1) : ['J1'];
    b.text = `Signals dark at ${b.area.junctions.join(', ')}`;
  } else if (b.area.links?.length) {
    b.area.links = b.area.links.slice(0, Math.max(1, b.area.links.length - 2));
    b.text = 'Corridor shortened';
  } else {
    b.text = `${b.text} (altered)`;
  }
  return b;
}

function fakeClosure(net: DigitalMarshal['engine']['net'], link = FAKE_LINK): MessageBody {
  const l = net.links[link];
  const area: MessageArea = { lanes: [{ link, lanes: l ? [...Array(l.lanes).keys()] : [0], s0: 5, s1: l ? Math.floor(l.length - 8) : 100 }] };
  return {
    type: 'ROAD_RESTRICTION',
    severity: 4,
    area,
    detail: { stage: 'full', link, lanes: (area.lanes![0].lanes ?? []).join(','), s0: 5, s1: area.lanes![0].s1 },
    text: `${l?.roadName ?? link} (${link}) closed to all traffic`,
  };
}

/** Build the message for one test, or null if it needs a live incident and there is none. */
export function buildInjection(dm: DigitalMarshal, id: InjectionId): SignedMessage | null {
  const spec = INJECTIONS.find((x) => x.id === id);
  if (!spec) return null;
  const net = dm.engine.net;
  const now = dm.now;
  const s = dm.s;
  const tgt = target(dm);
  if (spec.needsIncident && !tgt) return null;
  const fresh = { issuedAt: now, validFrom: now, validUntil: now + 900, mapVersion: net.version };
  const fakeInc = { incidentId: `INC-9${String(s.nextIncident).padStart(3, '0')}`, version: 1 };
  const base = (over: Partial<MessageHeader> = {}): Omit<MessageHeader, 'msgId'> => ({
    ...fakeInc,
    issuer: spec.issuer,
    ...fresh,
    ...over,
  });

  switch (id) {
    case 'tampered': {
      // a genuine message intercepted and altered: the original signature no longer matches
      if (tgt) {
        const body = altered(tgt.msg.body, net);
        const h: MessageHeader = { ...tgt.msg.header, issuedAt: now };
        h.msgId = `M-${digestHex(signedBytes(h, body)).slice(0, 10)}`;
        return { header: h, body, sig: { ...tgt.msg.sig }, origin: 'injected', test: id };
      }
      const m = seal(base(), fakeClosure(net), spec.signer, id);
      m.body = altered(m.body, net);
      m.header.msgId = `M-${digestHex(signedBytes(m.header, m.body)).slice(0, 10)}`;
      return m;
    }
    case 'forged':
    case 'rogue':
      return seal(base(), fakeClosure(net), spec.signer, id);
    case 'retired':
      return seal(
        base(),
        { type: 'SIGNAL_OUTAGE', severity: 4, area: { junctions: ['J7'] }, detail: { restriction: 'uncontrolled_junction' }, text: 'Signals dark at J7' },
        spec.signer,
        id,
      );
    case 'permission':
      // the contractor's genuine key, used for something it may not say
      return seal(
        base(),
        { type: 'SIGNAL_OUTAGE', severity: 4, area: { junctions: ['J3'] }, detail: { restriction: 'uncontrolled_junction' }, text: 'Signals dark at J3' },
        spec.signer,
        id,
      );
    case 'scope':
      // the contractor's genuine key, for a road it holds no permit for
      return seal(base(), fakeClosure(net, FAKE_LINK), spec.signer, id);
    case 'location': {
      const body = fakeClosure(net);
      body.area = { lanes: [{ link: 'J3>J11', lanes: [0, 1], s0: 5, s1: 200 }] };
      body.text = 'Closure on J3>J11';
      return seal(base(), body, spec.signer, id);
    }
    case 'map':
      return seal(base({ mapVersion: 'DMD-0.legacy' }), fakeClosure(net), spec.signer, id);
    case 'expired':
      return seal(base({ issuedAt: now - 120, validFrom: now - 120, validUntil: now - 20 }), fakeClosure(net), spec.signer, id);
    case 'stale':
      // a genuine-looking capture replayed seven minutes later
      return seal(base({ issuedAt: now - 420, validFrom: now - 420, validUntil: now + 600 }), fakeClosure(net), spec.signer, id);
    case 'future':
      return seal(base({ issuedAt: now + 900, validFrom: now + 900, validUntil: now + 1800 }), fakeClosure(net), spec.signer, id);
    case 'outdated': {
      // an earlier version of the live incident arriving late (delayed or replayed)
      const { inc, msg } = tgt!;
      let body = msg.body;
      for (let i = inc.messages.length - 1; i >= 0; i--) {
        const m = s.messages[inc.messages[i]];
        if (m && m.header.issuer === 'DM-TMC' && m.header.version < msg.header.version && m.body.type !== 'ROUTE_ADVISORY') {
          body = m.body;
          break;
        }
      }
      return seal(
        { incidentId: inc.id, version: Math.max(0, msg.header.version - 1), issuer: 'DM-TMC', ...fresh, validFrom: now, validUntil: now + 600 },
        structuredClone(body),
        spec.signer,
        id,
      );
    }
    case 'conflict': {
      // same version number as the live incident, different content: a faulty or compromised issuer
      const { inc, msg } = tgt!;
      return seal(
        { incidentId: inc.id, version: msg.header.version, issuer: 'DM-TMC', ...fresh, validFrom: msg.header.validFrom, validUntil: msg.header.validUntil },
        altered(msg.body, net),
        spec.signer,
        id,
      );
    }
  }
}
