/** Keep each SHA-256 pair together, with a space after every fourth pair. */
export function groupFingerprint256(fingerprint: string): string {
  const pairs = fingerprint.split(':');
  const groups: string[] = [];
  for (let i = 0; i < pairs.length; i += 4) groups.push(pairs.slice(i, i + 4).join(':'));
  return groups.join(' ');
}
