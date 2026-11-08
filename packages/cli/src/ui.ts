/**
 * Terminal output and questions, in the same shape as `@waniwani/kit`'s, so a
 * command reads the same from either package's `waniwani` binary.
 *
 * Questions run on @clack/prompts. A question is never asked where nobody can
 * answer it (a pipe, CI): `canAsk()` is that test, and every command that needs
 * an answer checks it first and fails with what to run instead.
 */

import {
	cancel,
	confirm,
	intro,
	isCancel,
	isCI,
	outro,
	select,
	spinner,
	text,
} from "@clack/prompts";

/** ESC by char code: a raw control byte in source is invisible and fragile. */
const ESC = String.fromCharCode(27);

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap =
	(code: string) =>
	(value: string): string =>
		useColor ? `${ESC}[${code}m${value}${ESC}[0m` : value;

export const red = wrap("31");
export const green = wrap("32");
export const yellow = wrap("33");
export const dim = wrap("2");
export const bold = wrap("1");

/** One URL a command hands the developer, label padded so a list aligns. */
export function endpoint(label: string, url: string): string {
	return `  ${dim(label.padEnd(8))} ${green(url)}`;
}

/** The one-line wordmark a command opens with. */
export function banner(version: string): void {
	console.log(`\n${useColor ? bold(green("waniwani")) : "waniwani"} ${dim(`v${version}`)}`);
}

/** Both ends a terminal, and not a CI runner. */
export function canAsk(): boolean {
	return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isCI();
}

/** A heading held until the first question, so a run that asks nothing draws no rail. */
let pending: string | null = null;
let asking = false;

export function open(title: string): void {
	pending = title;
}

function rail(): void {
	if (pending === null) return;
	intro(pending);
	pending = null;
	asking = true;
}

/** End the question block with the line that says what happened. */
export function close(line: string): void {
	pending = null;
	if (asking) {
		asking = false;
		outro(line);
		return;
	}
	console.log(`${green("✓")} ${line}`);
}

/** Ctrl-c on a question ends the command at 130, the shell's code for an interrupt. */
function answered<T>(value: T): Exclude<T, symbol> {
	if (isCancel(value)) {
		cancel("cancelled", { output: process.stderr });
		process.exit(130);
	}
	return value as Exclude<T, symbol>;
}

export interface Choice<T extends string> {
	value: T;
	label: string;
	hint?: string;
}

export async function askText(
	message: string,
	fallback: string,
	validate?: (value: string | undefined) => string | undefined,
): Promise<string> {
	rail();
	const answer = answered(
		await text({ message, placeholder: fallback, defaultValue: fallback, validate }),
	);
	return answer.trim() || fallback;
}

export async function askOne<T extends string>(
	message: string,
	choices: Choice<T>[],
	initial?: T,
): Promise<T> {
	rail();
	return answered(
		await select<T>({
			message,
			// `Option<T>` stays a deferred conditional while T is a parameter.
			options: choices as Parameters<typeof select<T>>[0]["options"],
			initialValue: initial ?? (choices[0] as Choice<T>).value,
		}),
	);
}

export async function askYesNo(message: string, fallback: boolean): Promise<boolean> {
	rail();
	return answered(await confirm({ message, initialValue: fallback }));
}

/** A step that takes a moment. */
export interface Task {
	done(line: string): void;
	failed(line: string): void;
}

/**
 * A spinner on a terminal, two plain lines anywhere else. A spinner redraws by
 * cursor movement, which a pipe or a CI log records as one frame per tick.
 */
export function task(label: string): Task {
	if (process.stdout.isTTY) {
		const progress = spinner();
		progress.start(label);
		return { done: (line) => progress.stop(line), failed: (line) => progress.error(line) };
	}
	console.log(dim(`${label}…`));
	return {
		done: (line) => console.log(`${green("✓")} ${line}`),
		failed: (line) => console.error(`${red("✗")} ${line}`),
	};
}
