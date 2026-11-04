declare module "bun:test" {
	type MaybePromise = void | Promise<void>;

	export function describe(name: string, fn: () => MaybePromise): void;
	export function test(name: string, fn: () => MaybePromise): void;
	export function it(name: string, fn: () => MaybePromise): void;
	export function beforeEach(fn: () => MaybePromise): void;
	export function afterEach(fn: () => MaybePromise): void;
	export function mock(fn?: (...args: unknown[]) => unknown): MockFunction;

	interface MockFunction {
		(...args: unknown[]): unknown;
		mockClear(): void;
		mockImplementationOnce(fn: (...args: unknown[]) => unknown): MockFunction;
		mock: { calls: unknown[][] };
	}

	interface Matchers {
		toBe(expected: unknown): void;
		toEqual(expected: unknown): void;
		toHaveLength(expected: number): void;
		toMatchObject(expected: Record<string, unknown>): void;
		toBeDefined(): void;
		toBeGreaterThan(expected: number): void;
		toBeGreaterThanOrEqual(expected: number): void;
		toStartWith(expected: string): void;
		toBeFunction(): void;
		toBeString(): void;
		toHaveBeenCalled(): void;
		toHaveBeenCalledTimes(expected: number): void;
		toContain(expected: string): void;
	}

	export function expect(actual: unknown): Matchers;
}
