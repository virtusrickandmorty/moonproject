/** Web Crypto is built into Node and browsers, so the web app needs no node:crypto shim. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
