import { describe, expect, test } from "bun:test";
import { decryptValue, encryptValue, isEncryptedEnvelope } from "../crypto";

// Generate a valid 32-byte key (base64-encoded)
function generateKey(): string {
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
	return Buffer.from(bytes).toString("base64");
}

describe("isEncryptedEnvelope", () => {
	test("returns true for a valid envelope", () => {
		expect(isEncryptedEnvelope({ __ww_enc: 1, ct: "abc", iv: "def" })).toBe(
			true,
		);
	});

	test("returns false for a plain object", () => {
		expect(isEncryptedEnvelope({ step: "collect_info", state: {} })).toBe(
			false,
		);
	});

	test("returns false for null", () => {
		expect(isEncryptedEnvelope(null)).toBe(false);
	});

	test("returns false when __ww_enc is not 1", () => {
		expect(isEncryptedEnvelope({ __ww_enc: 2, ct: "a", iv: "b" })).toBe(false);
	});

	test("returns false when ct or iv are missing", () => {
		expect(isEncryptedEnvelope({ __ww_enc: 1, ct: "a" })).toBe(false);
		expect(isEncryptedEnvelope({ __ww_enc: 1, iv: "b" })).toBe(false);
	});
});

describe("encryptValue / decryptValue", () => {
	const key = generateKey();

	test("round-trip produces original value", async () => {
		const original = { step: "collect_info", state: { breed: "labrador" } };
		const envelope = await encryptValue(original, key);
		const decrypted = await decryptValue(envelope, key);
		expect(decrypted).toEqual(original);
	});

	test("envelope has correct shape", async () => {
		const envelope = await encryptValue({ foo: "bar" }, key);
		expect(envelope.__ww_enc).toBe(1);
		expect(typeof envelope.ct).toBe("string");
		expect(typeof envelope.iv).toBe("string");
		expect(envelope.ct.length).toBeGreaterThan(0);
		expect(envelope.iv.length).toBeGreaterThan(0);
	});

	test("each encryption produces a unique IV and ciphertext", async () => {
		const value = { same: "data" };
		const a = await encryptValue(value, key);
		const b = await encryptValue(value, key);
		expect(a.iv).not.toBe(b.iv);
		expect(a.ct).not.toBe(b.ct);
	});

	test("decrypting with the wrong key throws", async () => {
		const envelope = await encryptValue({ secret: true }, key);
		const wrongKey = generateKey();
		await expect(decryptValue(envelope, wrongKey)).rejects.toThrow(
			"Decryption failed",
		);
	});

	test("tampered ciphertext causes decryption failure", async () => {
		const envelope = await encryptValue({ data: 123 }, key);
		// Flip a byte in the ciphertext
		const raw = Buffer.from(envelope.ct, "base64");
		raw[0] = raw[0] ^ 0xff;
		const tampered = { ...envelope, ct: raw.toString("base64") };
		await expect(decryptValue(tampered, key)).rejects.toThrow(
			"Decryption failed",
		);
	});

	test("invalid key length throws", async () => {
		const shortKey = Buffer.from("too-short").toString("base64");
		await expect(encryptValue({ a: 1 }, shortKey)).rejects.toThrow("32-byte");
	});

	test("handles empty object", async () => {
		const envelope = await encryptValue({}, key);
		const decrypted = await decryptValue(envelope, key);
		expect(decrypted).toEqual({});
	});

	test("handles nested and complex values", async () => {
		const complex = {
			users: [{ name: "Alice", age: 30 }],
			metadata: { nested: { deep: true } },
			count: 42,
			active: false,
			nothing: null,
		};
		const envelope = await encryptValue(complex, key);
		const decrypted = await decryptValue(envelope, key);
		expect(decrypted).toEqual(complex);
	});
});
