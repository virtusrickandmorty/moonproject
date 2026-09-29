/** Keep each SHA-256 pair together, with a space after every fourth pair. */
export function groupFingerprint256(fingerprint: string): string {
  const pairs = fingerprint.split(':');
  const groups: string[] = [];
  for (let i = 0; i < pairs.length; i += 4) groups.push(pairs.slice(i, i + 4).join(':'));
  return groups.join(' ');
}

/** Which network a join address is on: the shop's own, or the VPN (NetBird and the like give 100.64.x.x to 100.127.x.x). */
export const addressKind = (kind: 'lan' | 'vpn') => (kind === 'vpn' ? 'from outside the shop, over the VPN' : 'in the shop, on its Wi-Fi or network');
