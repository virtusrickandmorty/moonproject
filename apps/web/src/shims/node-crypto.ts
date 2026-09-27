/** Browser stand-in for the one node:crypto function @moonproject/shared uses. */
export const randomUUID = (): string => globalThis.crypto.randomUUID();
