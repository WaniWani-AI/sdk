// Browser shim for Node's "crypto" module.
// Some bundled dependencies (e.g. nanoid) have a fallback `require("crypto")`
// path for Node.js. In the browser IIFE, we redirect to the native Web Crypto
// API which provides everything the chat widget actually needs.

export default globalThis.crypto;
export const webcrypto = globalThis.crypto;
export function randomUUID() {
	return globalThis.crypto.randomUUID();
}
export function getRandomValues(buf: Uint8Array) {
	return globalThis.crypto.getRandomValues(buf);
}
