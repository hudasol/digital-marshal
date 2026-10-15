import { demoKey } from './crypto';
import type { MessageType } from './types';

/* Trust store: which simulated issuers are recognised, what they may say and where.
   A valid signature proves who sent a message and that it was not altered; it does not prove that
   the message is physically true. Permissions and scope limit what each issuer may assert. */

export interface IssuerCert {
  id: string;
  name: string;
  keyId: string;
  publicKeyHex: string;
  permissions: MessageType[];
  /** where the issuer may assert anything: the whole district, or listed links and junctions */
  scope: { district: true } | { links: string[]; junctions: string[] };
  validFrom: number;
  validTo: number;
}

function cert(id: string, name: string, permissions: MessageType[], scope: IssuerCert['scope'], validTo = Infinity): IssuerCert {
  const k = demoKey(id);
  return { id, name, keyId: k.keyId, publicKeyHex: k.publicKeyHex, permissions, scope, validFrom: -Infinity, validTo };
}

export const TRUST_STORE: Record<string, IssuerCert> = {
  'DM-TMC': cert(
    'DM-TMC',
    'Digital Marshal coordination node (simulated)',
    ['SIGNAL_OUTAGE', 'SIGNAL_RESTORED', 'ROAD_RESTRICTION', 'RESTRICTION_LIFTED', 'EMERGENCY_CORRIDOR', 'CORRIDOR_CLEARED', 'ROUTE_ADVISORY'],
    { district: true },
  ),
  'EMS-DISPATCH': cert('EMS-DISPATCH', 'Emergency dispatch (simulated)', ['EMERGENCY_CORRIDOR', 'CORRIDOR_CLEARED'], { district: true }),
  'WORKS-C07': cert('WORKS-C07', 'Roadworks contractor C07 (simulated)', ['ROAD_RESTRICTION', 'RESTRICTION_LIFTED'], {
    links: ['J3>J7', 'J7>J3'],
    junctions: [],
  }),
  'FLEET-RA': cert('FLEET-RA', 'Robotaxi fleet remote assistance desk (simulated)', ['ASSISTANCE_AUTHORIZATION'], { district: true }),
  // a former node key whose certificate has lapsed: correct signatures, but no longer trusted
  'DM-TMC-2025': cert('DM-TMC-2025', 'Retired coordination node key (simulated)', ['SIGNAL_OUTAGE', 'ROAD_RESTRICTION'], { district: true }, -1),
};

/** Issuers that hold keys but are not in the trust store (used only by the security demonstration). */
export const UNTRUSTED_ISSUERS = ['ROGUE-77'];

export function issuerKey(id: string) {
  return demoKey(id);
}
