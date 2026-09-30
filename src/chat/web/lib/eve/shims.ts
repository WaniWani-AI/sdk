function withResolvers<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function anySignal(signals: Iterable<AbortSignal>): AbortSignal {
	const controller = new AbortController();
	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			return controller.signal;
		}
		signal.addEventListener("abort", () => controller.abort(signal.reason), {
			once: true,
			signal: controller.signal,
		});
	}
	return controller.signal;
}

/** eve's browser client calls both, which Safari before 17.4 and Firefox before 124 lack. */
export function installEveShims(): void {
	if (!("withResolvers" in Promise)) {
		Object.defineProperty(Promise, "withResolvers", {
			value: withResolvers,
			configurable: true,
			writable: true,
		});
	}
	if (!("any" in AbortSignal)) {
		Object.defineProperty(AbortSignal, "any", {
			value: anySignal,
			configurable: true,
			writable: true,
		});
	}
}
