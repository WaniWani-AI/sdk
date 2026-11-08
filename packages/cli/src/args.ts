/** Command-line arguments, read the way `@waniwani/kit` reads them. */

/**
 * Parsed `--flags`. A `--no-x` switch reads as `x: false`. Loose on purpose: the
 * kit parses its own command line and hands the result to this package.
 */
export type Flags = Record<string, string | boolean | undefined>;

/** Flags that take a value; every other flag is a boolean switch. */
const VALUE_FLAGS = new Set(["port", "region"]);

export function parseArgs(argv: string[]): { flags: Flags; positional: string[] } {
	const flags: Flags = {};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] as string;
		if (!arg.startsWith("--")) {
			positional.push(arg);
			continue;
		}
		const [name, inline] = arg.slice(2).split("=") as [string, string | undefined];
		if (name.startsWith("no-")) {
			flags[name.slice(3)] = false;
			continue;
		}
		flags[name] = VALUE_FLAGS.has(name) ? (inline ?? argv[++i]) : true;
	}
	return { flags, positional };
}

/** A string-valued flag, or undefined when it is absent or was given as a bare switch. */
export function stringFlag(flags: Flags, name: string): string | undefined {
	const value = flags[name];
	return typeof value === "string" ? value : undefined;
}
