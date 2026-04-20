/**
 * AES-256-GCM encryption for KV store values.
 *
 * When `WANIWANI_ENCRYPTION_KEY` is set, values are encrypted before
 * being sent to the WaniWani API and decrypted on read. The server
 * never sees plaintext flow state.
 *
 * Key format: base64-encoded 32-byte (256-bit) key.
 * Generate with: `openssl rand -base64 32`
 */

// ============================================================================
// Types
// ============================================================================

/** Encrypted value envelope stored as JSONB in the KV store. */
export type EncryptedEnvelope = {
	/** Version marker — allows future algorithm changes. */
	__ww_enc: 1;
	/** Base64-encoded ciphertext (includes GCM auth tag). */
	ct: string;
	/** Base64-encoded 12-byte IV. */
	iv: string;
};

// ============================================================================
// Type guard
// ============================================================================

export function isEncryptedEnvelope(
	value: unknown,
): value is EncryptedEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as EncryptedEnvelope).__ww_enc === 1 &&
		typeof (value as EncryptedEnvelope).ct === "string" &&
		typeof (value as EncryptedEnvelope).iv === "string"
	);
}

// ============================================================================
// Key cache
// ============================================================================

const keyCache = new Map<string, CryptoKey>();

async function importKey(keyBase64: string): Promise<CryptoKey> {
	const cached = keyCache.get(keyBase64);
	if (cached) {
		return cached;
	}

	const raw = Buffer.from(keyBase64, "base64");
	if (raw.length !== 32) {
		throw new Error(
			"[WaniWani KV] WANIWANI_ENCRYPTION_KEY must be a base64-encoded 32-byte (256-bit) key.",
		);
	}

	const cryptoKey = await globalThis.crypto.subtle.importKey(
		"raw",
		raw,
		{ name: "AES-GCM" },
		false,
		["encrypt", "decrypt"],
	);

	keyCache.set(keyBase64, cryptoKey);
	return cryptoKey;
}

// ============================================================================
// Encrypt / Decrypt
// ============================================================================

export async function encryptValue(
	value: Record<string, unknown>,
	keyBase64: string,
): Promise<EncryptedEnvelope> {
	const key = await importKey(keyBase64);
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const plaintext = new TextEncoder().encode(JSON.stringify(value));

	const ciphertext = await globalThis.crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		plaintext,
	);

	return {
		__ww_enc: 1,
		ct: Buffer.from(ciphertext).toString("base64"),
		iv: Buffer.from(iv).toString("base64"),
	};
}

export async function decryptValue<T = Record<string, unknown>>(
	envelope: EncryptedEnvelope,
	keyBase64: string,
): Promise<T> {
	const key = await importKey(keyBase64);
	const ct = Buffer.from(envelope.ct, "base64");
	const iv = Buffer.from(envelope.iv, "base64");

	let plaintext: ArrayBuffer;
	try {
		plaintext = await globalThis.crypto.subtle.decrypt(
			{ name: "AES-GCM", iv },
			key,
			ct,
		);
	} catch {
		throw new Error(
			"[WaniWani KV] Decryption failed. The encryption key may be incorrect or the data may be corrupted.",
		);
	}

	return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
