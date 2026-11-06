/**
 * The questions `waniwani init` asks, and the shape it asks them in.
 *
 * Arrow-driven, on top of @clack/prompts: raw mode, the redraw on every
 * keystroke, the cursor restore and the ctrl-c path are one dependency's
 * problem rather than four hand-rolled ones. It is the same library `eve init`
 * and `skills add` render their flows with, so the first `waniwani init`
 * somebody runs needs no reading.
 *
 * A question is skipped rather than degraded when there is nothing to ask:
 * `--yes`, a flag that already carries the answer, a pipe, or a CI runner.
 * `canAsk()` is that one test and `init` takes it once, because a scripted run
 * blocking on a cursor in a build log is the failure mode worth designing out.
 * Everything a skipped run prints goes through `close()` and `fail()`, so the
 * two paths say the same thing with and without the rail.
 */

import {
	cancel,
	intro,
	isCancel,
	isCI,
	type Option,
	outro,
	S_BAR,
	select,
	text,
} from "@clack/prompts";
import { dim, green, red } from "./log.js";

/** One row of a select: the value it answers with, and how it reads. */
export interface Choice<T extends string> {
	value: T;
	label: string;
	/** Printed dimmed beside the label, on the highlighted row. */
	hint?: string;
}

/**
 * Whether this run can ask anything at all.
 *
 * Both ends have to be a terminal — a prompt needs stdin in raw mode and stdout
 * to draw on — and a CI runner is a terminal often enough to be worth ruling out
 * by name. `--yes` is the caller's own answer and is checked at the call site.
 */
export function canAsk(): boolean {
	return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isCI();
}

/** A title `open()` took, drawn by the first question that actually gets asked. */
let pending: string | null = null;

/** Whether the rail is drawn and waiting for an end cap. */
let asking = false;

/**
 * Open the question block, if there turns out to be a question.
 *
 * The heading is held rather than printed, because a run whose flags happen to
 * answer everything asks nothing, and a rail around nothing is a header with no
 * body under it. The first prompt draws it; a run without one never does.
 */
export function open(title: string): void {
	pending = title;
}

/** Draw the held heading. Called by every prompt, does its work once. */
function rail(): void {
	if (pending === null) return;
	intro(pending);
	pending = null;
	asking = true;
}

/**
 * Close the question block with the one line that says what happened.
 *
 * The end cap carries information rather than a farewell, so the line reads the
 * same whether it arrived under a rail or on its own after a `--yes` run.
 */
export function close(line: string): void {
	pending = null;
	if (asking) {
		asking = false;
		outro(line);
		return;
	}
	console.log(`\n${green("✓")} ${line}\n`);
}

/**
 * Close the question block on a refusal, and hand the caller stderr to keep
 * explaining on. Red end cap, and no prompt after it.
 */
export function fail(line: string): void {
	pending = null;
	if (asking) {
		asking = false;
		// `cancel` draws the end cap without the rail segment above it that `outro`
		// draws, so the answer it lands under would touch it. One bar of our own.
		process.stderr.write(`${dim(S_BAR)}\n`);
		cancel(line, { output: process.stderr });
		return;
	}
	console.error(`\n${red("✗")} ${line}\n`);
}

/**
 * Ctrl-c out of a question ends the command at 130 — the shell's own code for an
 * interrupted program, so a wrapper can tell it apart from a scaffold that
 * failed. Nothing has been written at this point, so there is nothing to undo
 * and nothing to report beyond the word.
 */
function answered<T>(value: T | symbol): T {
	if (isCancel(value)) {
		cancel("cancelled", { output: process.stderr });
		process.exit(130);
	}
	return value;
}

/** One line of text, with `fallback` shown as the placeholder and taken on Enter. */
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

/** One choice out of a list, arrow keys to move, Enter to take the highlighted row. */
export async function askOne<T extends string>(
	message: string,
	choices: Choice<T>[],
	initial?: T,
): Promise<T> {
	rail();
	return answered(
		await select<T>({
			message,
			// `Option` resolves through a conditional on its value type, which stays
			// deferred while T is a parameter. Every field of Choice satisfies either
			// branch, so the cast asserts what the constraint cannot.
			options: choices as Option<T>[],
			initialValue: initial ?? (choices[0] as Choice<T>).value,
		}),
	);
}
