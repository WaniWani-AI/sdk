import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://localhost" });
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).localStorage = win.localStorage;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).sessionStorage = win.sessionStorage;

const { setConsent } = await import("../../../../shared/consent");
const { savedSession, saveSession } = await import("./session");

const KEY = "chan_1";
const STORAGE_KEY = `waniwani:eve-conversation:${KEY}`;
const record = { conversationId: "conv_1", ownerSecret: "secret_1" };
const other = { conversationId: "conv_2", ownerSecret: "secret_2" };

function stored(storage: Storage): unknown {
	const raw = storage.getItem(STORAGE_KEY);
	return raw === null ? null : JSON.parse(raw);
}

/** Records every localStorage access so a test can assert none happened. */
function installSpyLocalStorage(): string[] {
	const real = win.localStorage;
	const ops: string[] = [];
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).localStorage = {
		getItem: (k: string) => {
			ops.push(`get:${k}`);
			return real.getItem(k);
		},
		setItem: (k: string, v: string) => {
			ops.push(`set:${k}`);
			real.setItem(k, v);
		},
		removeItem: (k: string) => {
			ops.push(`remove:${k}`);
			real.removeItem(k);
		},
		clear: () => real.clear(),
		key: (i: number) => real.key(i),
		get length() {
			return real.length;
		},
	};
	return ops;
}

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).localStorage = win.localStorage;
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).sessionStorage = win.sessionStorage;
	win.localStorage.clear();
	win.sessionStorage.clear();
});

afterEach(() => {
	setConsent("granted");
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).localStorage = win.localStorage;
	win.localStorage.clear();
	win.sessionStorage.clear();
});

describe("saveSession / savedSession with consent", () => {
	test("saves to localStorage under the conversation key, not sessionStorage", () => {
		saveSession(KEY, record);
		expect(stored(win.localStorage)).toEqual(record);
		expect(stored(win.sessionStorage)).toBeNull();
		expect(savedSession(KEY)).toEqual(record);
	});

	test("reading falls back to sessionStorage when localStorage has nothing", () => {
		win.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
		expect(savedSession(KEY)).toEqual(record);
	});

	test("localStorage wins when both hold a record", () => {
		win.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
		win.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(other));
		expect(savedSession(KEY)).toEqual(record);
	});

	test("a malformed localStorage record falls back to sessionStorage", () => {
		win.localStorage.setItem(STORAGE_KEY, "{not json");
		win.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
		expect(savedSession(KEY)).toEqual(record);
	});

	test("a record missing a field reads as nothing", () => {
		win.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ conversationId: "conv_1" }),
		);
		expect(savedSession(KEY)).toBeNull();
	});

	test("keys are isolated", () => {
		saveSession(KEY, record);
		expect(savedSession("chan_2")).toBeNull();
	});

	test("a grant after a pending save keeps resuming from sessionStorage", () => {
		setConsent("pending");
		saveSession(KEY, record);
		setConsent("granted");
		expect(savedSession(KEY)).toEqual(record);
	});

	test("saving under grant moves a pending-era record out of sessionStorage", () => {
		setConsent("pending");
		saveSession(KEY, other);
		setConsent("granted");
		saveSession(KEY, record);
		expect(stored(win.localStorage)).toEqual(record);
		expect(stored(win.sessionStorage)).toBeNull();
		expect(savedSession(KEY)).toEqual(record);
	});

	test("saveSession(key, null) clears both stores", () => {
		win.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
		win.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(other));
		saveSession(KEY, null);
		expect(win.localStorage.getItem(STORAGE_KEY)).toBeNull();
		expect(win.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
		expect(savedSession(KEY)).toBeNull();
	});
});

for (const consent of ["pending", "denied"] as const) {
	describe(`saveSession / savedSession while ${consent}`, () => {
		test("saves to sessionStorage only and leaves localStorage untouched", () => {
			setConsent(consent);
			const ops = installSpyLocalStorage();
			saveSession(KEY, record);
			expect(ops).toEqual([]);
			expect(stored(win.sessionStorage)).toEqual(record);
			expect(win.localStorage.getItem(STORAGE_KEY)).toBeNull();
			expect(savedSession(KEY)).toEqual(record);
			expect(ops).toEqual([]);
		});

		test("reading ignores a record a previous grant left in localStorage", () => {
			win.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
			setConsent(consent);
			const ops = installSpyLocalStorage();
			expect(savedSession(KEY)).toBeNull();
			expect(ops).toEqual([]);
		});

		test("reading returns the sessionStorage record, not the localStorage one", () => {
			win.localStorage.setItem(STORAGE_KEY, JSON.stringify(other));
			setConsent(consent);
			saveSession(KEY, record);
			expect(savedSession(KEY)).toEqual(record);
			// The earlier grant's record is not overwritten by a save without consent.
			expect(stored(win.localStorage)).toEqual(other);
		});

		test("saveSession(key, null) clears both stores", () => {
			win.localStorage.setItem(STORAGE_KEY, JSON.stringify(other));
			setConsent(consent);
			saveSession(KEY, record);
			saveSession(KEY, null);
			expect(win.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
			expect(win.localStorage.getItem(STORAGE_KEY)).toBeNull();
			setConsent("granted");
			expect(savedSession(KEY)).toBeNull();
		});

		test("a throwing sessionStorage neither throws nor falls through to localStorage", () => {
			setConsent(consent);
			// biome-ignore lint/suspicious/noExplicitAny: test setup
			(globalThis as any).sessionStorage = {
				getItem: () => {
					throw new Error("blocked");
				},
				setItem: () => {
					throw new Error("blocked");
				},
				removeItem: () => {
					throw new Error("blocked");
				},
				clear: () => {},
				key: () => null,
				length: 0,
			};
			const ops = installSpyLocalStorage();
			expect(() => saveSession(KEY, record)).not.toThrow();
			expect(savedSession(KEY)).toBeNull();
			expect(ops).toEqual([]);
		});
	});
}
