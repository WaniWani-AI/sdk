export async function waitFor(
	predicate: () => boolean,
	options: { timeoutMs?: number; stepMs?: number } = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 1_000;
	const stepMs = options.stepMs ?? 10;
	const start = Date.now();

	while (Date.now() - start < timeoutMs) {
		if (predicate()) {
			return;
		}
		await delay(stepMs);
	}

	throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

export async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}
