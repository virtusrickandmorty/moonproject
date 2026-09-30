/**
 * The shop's CA as the screens show it (PLAN C6): its code, so a device's "Join this PC" page can be checked from a
 * signed-in screen too, and the address staff type on a phone or another PC to join: this PC's name and its private
 * addresses (the LAN, and the VPN's 100.64.x.x when it is up).
 */
import { hostname } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../../app.ts';
import type { Db } from '../../../platform/db/driver.ts';
import { localNames, type Names } from './certs.ts';
import { currentCa } from './store.ts';

/** This PC on the network; tests give their own. */
export interface Network {
  pcName(): string;
  names(): Names;
  /** The port the "Join this PC" page listens on (80, or 8080 when another program has 80), or null when it is not running. */
  joinPort(): number | null;
}

const realNetwork: Network = { pcName: hostname, names: localNames, joinPort: () => null };
/** The real network with what a caller (main.ts, a test) gives in its place. */
export const networkOf = (given: Partial<Network> = {}): Network => ({ ...realNetwork, ...given });
const isVpn = (ip: string) => ip.startsWith('100.') && Number(ip.split('.')[1]) >= 64 && Number(ip.split('.')[1]) < 128;

/** Where a device joins: `http://<address>/` for each private address, with the port when it is not 80. */
export function joinAddress(n: Network) {
  const port = n.joinPort();
  const addresses = n.names().ips.filter((ip) => !ip.startsWith('127.')).map((ip) => ({ ip, kind: isVpn(ip) ? 'vpn' as const : 'lan' as const }));
  return {
    pcName: n.pcName(),
    addresses,
    port,
    urls: port === null ? [] : addresses.map((a) => `http://${a.ip}${port === 80 ? '' : `:${port}`}/`),
  };
}

/**
 * Where a printed QR code points (PRT job ticket and release slip): the LAN join address, else the first one. The join
 * page sends every other path on to the app over HTTPS, so `<this>docs/...` opens the document. Undefined before the
 * server has run on the network or while the join page is off: the code then holds only the document number.
 */
export function printLinkBase(db: Db, n: Network): string | undefined {
  if (!currentCa(db)) return undefined;
  const join = joinAddress(n);
  const lan = join.addresses.findIndex((a) => a.kind === 'lan');
  return join.urls[lan >= 0 ? lan : 0];
}

export function tlsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const n = deps.network;
  /** The CA is null before the server has first run on the network (LAN mode), and then there is no page to join. */
  app.get('/api/system/tls', { config: { permission: 'authenticated' } }, async () => {
    const ca = currentCa(deps.db);
    return ca ? { ca, join: joinAddress(n) } : { ca };
  });
}
