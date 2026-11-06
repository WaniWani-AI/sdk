/** Build output formatting. Errors point at a file and say how to fix it. */

import type { App, Diagnostic, Report } from "./types.js";

/** An RGB triple, as the ramp works in. */
type Rgb = [number, number, number];

/** ESC by char code: a raw control byte in source is invisible and fragile. */
const ESC = String.fromCharCode(27);

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap =
	(code: string) =>
	(text: string): string =>
		useColor ? `${ESC}[${code}m${text}${ESC}[0m` : text;

export const red = wrap("31");
export const green = wrap("32");
export const yellow = wrap("33");
export const dim = wrap("2");
export const bold = wrap("1");

/**
 * The wordmark, at half the height of the art `waniwani login` prints.
 *
 * Same letterforms: the tall version is six rows of full blocks with a box-glyph
 * drop shadow, and each row here folds two of those together — `▀` where only
 * the upper row had ink, `▄` where only the lower did, `█` where both. Three
 * rows instead of six, at the same width, and nothing about the shapes changes.
 *
 * One colour per row rather than per glyph: a vertical ramp needs three escape
 * sequences instead of two hundred, and reads the same.
 */
const LOGO = [
	"██     ██ ▄█▀▀▀█▄ ███▄   ██  ██  ██     ██ ▄█▀▀▀█▄ ███▄   ██  ██",
	"██ ▄█▄ ██ ██▀▀▀██ ██ ▀█▄ ██  ██  ██ ▄█▄ ██ ██▀▀▀██ ██ ▀█▄ ██  ██",
	" ▀▀▀ ▀▀▀  ▀▀   ▀▀ ▀▀   ▀▀▀▀  ▀▀   ▀▀▀ ▀▀▀  ▀▀   ▀▀ ▀▀   ▀▀▀▀  ▀▀",
];

const LOGO_WIDTH = 65;

/** The brand accent, `#04d916`. */
const ACCENT: Rgb = [4, 217, 22];

/** How far the first and last rows are mixed toward white and black. */
const LIGHTEN = 0.42;
const DARKEN = 0.35;

/**
 * The ramp stop for one row: a tint of the accent at the top, the accent itself
 * in the middle, a shade of it at the bottom — so the wordmark reads as one
 * object lit from above.
 *
 * Interpolated from the row count rather than written out, so the art and the
 * ramp cannot drift apart when either changes.
 */
function rampStop(index: number, rows: number): Rgb {
	// -1 on the first row, 0 in the middle, +1 on the last.
	const position = rows === 1 ? 0 : (index / (rows - 1)) * 2 - 1;
	if (position <= 0) {
		const mix = LIGHTEN * -position;
		return ACCENT.map((channel) => Math.round(channel + (255 - channel) * mix)) as Rgb;
	}
	return ACCENT.map((channel) => Math.round(channel * (1 - DARKEN * position))) as Rgb;
}

/** 24-bit colour is used only where the terminal says it has it. */
const truecolor = ["truecolor", "24bit"].includes(process.env.COLORTERM ?? "");

/** The six levels each channel can take in the xterm 256-colour cube. */
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

/** The nearest cube entry, for a terminal that does not announce 24-bit colour. */
function cube([r, g, b]: Rgb): number {
	const nearest = (channel: number) =>
		CUBE_LEVELS.reduce(
			(best, level, index) =>
				Math.abs(level - channel) < Math.abs((CUBE_LEVELS[best] as number) - channel)
					? index
					: best,
			0,
		);
	return 16 + 36 * nearest(r) + 6 * nearest(g) + nearest(b);
}

/** The foreground escape for one row of the ramp. */
function ramp(index: number, rows: number): string {
	const rgb = rampStop(index, rows);
	if (!truecolor) {
		return `${ESC}[38;5;${cube(rgb)}m`;
	}
	return `${ESC}[38;2;${rgb.join(";")}m`;
}

/**
 * Print the banner a command opens with.
 *
 * The art needs 65 columns and a terminal that wants colour. A narrower one, a
 * pipe, a CI log or `NO_COLOR` gets the wordmark on one line instead — the same
 * information, and nothing that turns into wrapped garbage in a build log.
 */
export function banner(version: string): void {
	// `||`, not `??`: a pty whose window size was never set reports 0 columns,
	// which is unknown rather than narrow.
	const columns = process.stdout.columns || 80;
	if (!useColor || columns < LOGO_WIDTH) {
		// The wordmark still carries the accent — it is the same banner, narrowed.
		const mark = useColor ? `${ramp(0, 1)}${ESC}[1mwaniwani${ESC}[0m` : "waniwani";
		console.log(`\n${mark} ${dim(`v${version}`)}`);
		return;
	}
	console.log("");
	for (const [index, line] of LOGO.entries()) {
		console.log(`${ramp(index, LOGO.length)}${line}${ESC}[0m`);
	}
	console.log(dim(`v${version}`.padStart(LOGO_WIDTH)));
	console.log("");
}

/**
 * One URL a command hands the developer, in the shape every command uses for
 * them. The label is padded so a list of endpoints aligns whether the framework
 * printed the line or this CLI did.
 */
export function endpoint(label: string, url: string): string {
	return `  ${dim(label.padEnd(8))} ${green(url)}`;
}

/**
 * One line of what the build check found, as `<kind> <name>`.
 *
 * The column is as wide as the longest kind the check can print, which is
 * `well-known`, so every line aligns whatever an app happens to contain.
 */
function mounted(kind: string, name: string): string {
	return `  ${dim(kind.padEnd("well-known".length))} ${name}`;
}

function printGroup(entries: Diagnostic[], marker: string, color: (text: string) => string): void {
	const byFile = new Map<string, Diagnostic[]>();
	for (const entry of entries) {
		const list = byFile.get(entry.where) ?? [];
		list.push(entry);
		byFile.set(entry.where, list);
	}

	for (const [where, list] of byFile) {
		console.log(`  ${bold(where)}`);
		for (const entry of list) {
			console.log(`  ${color(marker)} ${entry.message}`);
			if (entry.hint) {
				console.log(`    ${dim(entry.hint)}`);
			}
		}
		console.log("");
	}
}

export function printReport(app: App, report: Report): void {
	if (!report.ok) {
		console.log(`\n${red("✗")} ${bold("Build check failed")}\n`);
		printGroup(report.errors, "└", red);
		if (report.warnings.length > 0) {
			printGroup(report.warnings, "└", yellow);
		}
		return;
	}

	const counts = (
		[
			[app.widgets.length, "widget"],
			[app.tools.length, "tool"],
			[app.flows.length, "flow"],
			[app.endpoints.length, "endpoint"],
		] as const
	)
		.filter(([count]) => count > 0)
		.map(([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`);

	console.log(`${green("✓")} ${bold("Build check passed")} ${dim(`— ${counts.join(", ")}`)}`);

	for (const widget of app.widgets) {
		console.log(mounted("widget", widget.name));
	}
	for (const tool of app.tools) {
		console.log(mounted("tool", tool.name));
	}
	for (const flow of app.flows) {
		console.log(mounted("flow", flow.name));
	}
	// Labelled by the folder it came from and printed as the path, not the
	// filename: the path is what a widget writes into a `fetch()` and what an
	// ownership check is configured with, so it is the thing worth reading this
	// line against.
	for (const endpoint of app.endpoints) {
		console.log(mounted(endpoint.mount, endpoint.path));
	}
	if (report.warnings.length > 0) {
		console.log("");
		printGroup(report.warnings, "└", yellow);
	}
}
