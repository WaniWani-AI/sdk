import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installEveShims } from "./shims";

const nativeWithResolvers = Object.getOwnPropertyDescriptor(
	Promise,
	"withResolvers",
);
const nativeAny = Object.getOwnPropertyDescriptor(AbortSignal, "any");

function restore(
	target: object,
	key: string,
	descriptor: PropertyDescriptor | undefined,
) {
	Reflect.deleteProperty(target, key);
	if (descriptor) {
		Object.defineProperty(target, key, descriptor);
	}
}

describe("installEveShims in a browser without the APIs eve needs", () => {
	beforeEach(() => {
		Reflect.deleteProperty(Promise, "withResolvers");
		Reflect.deleteProperty(AbortSignal, "any");
		installEveShims();
	});

	afterEach(() => {
		restore(Promise, "withResolvers", nativeWithResolvers);
		restore(AbortSignal, "any", nativeAny);
	});

	test("Promise.withResolvers settles its promise from outside", async () => {
		const resolved = Promise.withResolvers<number>();
		resolved.resolve(7);
		expect(await resolved.promise).toBe(7);

		const rejected = Promise.withResolvers<number>();
		rejected.reject(new Error("no"));
		expect(rejected.promise).rejects.toThrow("no");
	});

	test("AbortSignal.any aborts with the reason of whichever input aborts first", () => {
		const first = new AbortController();
		const second = new AbortController();
		const combined = AbortSignal.any([first.signal, second.signal]);
		expect(combined.aborted).toBe(false);

		second.abort("second");
		first.abort("first");
		expect(combined.aborted).toBe(true);
		expect(combined.reason).toBe("second");
	});

	test("AbortSignal.any is already aborted when an input already is", () => {
		const done = new AbortController();
		done.abort("early");
		const combined = AbortSignal.any([
			new AbortController().signal,
			done.signal,
		]);
		expect(combined.aborted).toBe(true);
		expect(combined.reason).toBe("early");
	});
});

test("installEveShims keeps a browser's native implementations", () => {
	installEveShims();
	expect(Object.getOwnPropertyDescriptor(Promise, "withResolvers")).toEqual(
		nativeWithResolvers,
	);
	expect(Object.getOwnPropertyDescriptor(AbortSignal, "any")).toEqual(
		nativeAny,
	);
});
