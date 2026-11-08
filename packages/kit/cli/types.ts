/**
 * The shapes that cross module boundaries in this CLI.
 *
 * Four of them carry the bugs this package has actually shipped, which is why
 * they are written down rather than inferred: `App` flows from the scanner into
 * both the validator and the generator, `Override` is the fleet-wide dependency
 * mechanism, `PackageManifest` is the object `codegen` performs surgery on, and
 * `Report` is the verdict every command exits on.
 *
 * Everything else in here is a small record that happens to be shared by two
 * modules. Types local to one module stay in that module.
 */

// -------------------------------------------------------------------- the app

/** A tool or a flow: one file, and the filename is the name. */
export interface AppModule {
	name: string;
	file: string;
}

/** A widget folder: the contract the server reads, the component the browser mounts. */
export interface AppWidget {
	name: string;
	dir: string;
	/** `widget.ts`, absent when the folder is missing one. */
	contract?: string;
	/** `ui.tsx`, absent when the folder is missing one. */
	ui?: string;
}

/** An HTTP endpoint, whose position in the app folder is the path it answers at. */
export interface AppEndpoint {
	/** The folder it came from, `api` or `well-known`, which is `segments[0]`. */
	mount: string;
	/** The URL, prefix included: `/api/cal/slots`, `/.well-known/security.txt`. */
	path: string;
	/**
	 * The file's position, mount folder first: `["api", "cal", "slots"]`. Both the
	 * import specifier the generator writes and the identifier it binds it to come
	 * from this, which is why the folder is part of it — two files with the same
	 * name under different mounts have to reach the generator as two names.
	 */
	segments: string[];
	file: string;
}

/** What `scanApp()` found by walking the app folder. */
export interface App {
	root: string;
	configFile?: string;
	tools: AppModule[];
	widgets: AppWidget[];
	flows: AppModule[];
	endpoints: AppEndpoint[];
	/** CSS files nothing imports, collected so the check can say they are dead. */
	strayStyles: string[];
}

// --------------------------------------------------------------- the template

/** A template resolved to a directory on disk, however it got there. */
export interface Template {
	dir: string;
	source: string;
	ref?: string;
	sha?: string;
	/** Served from `~/.cache/waniwani/templates/` rather than downloaded. */
	cached?: boolean;
	/** A local checkout, so there is no ref or sha to speak of. */
	local?: boolean;
	/** GitHub was unreachable and the newest cached copy was used instead. */
	offline?: boolean;
}

/** A template's own exclusion list, from `waniwani.template.json`. */
export interface TemplateManifest {
	exclude?: string[];
	buildExclude?: string[];
	preserve?: string[];
}

// ----------------------------------------------------------------- generation

/** Where a layout puts things, relative to the project root. */
export interface Layout {
	appDir: string;
	runtimeDir: string;
	/** The runtime arrives as source rather than as a package. */
	vendored: boolean;
}

export type LayoutName = "build" | "eject";

/**
 * One decision the runtime took on top of what the template declared.
 *
 * `from` absent means the entry was added rather than changed, `removed` means
 * it was dropped, and `conflict` means the app declared something the runtime
 * disagrees with and the app won.
 */
export interface Override {
	name: string;
	from?: string;
	to?: string;
	why: string;
	conflict?: boolean;
	removed?: boolean;
}

/** What `generate()` did, for the CLI to report. */
export interface GenerateResult {
	outDir: string;
	written: string[];
	overrides: Override[];
	fromTemplate: string[];
	/** Top-level entries an in-place eject moved under `src/app/`. */
	moved: string[];
	manifest: boolean;
}

/** What a previous build recorded in `.template.json`. */
export interface Provenance {
	files?: string[];
	views?: string[];
}

// ------------------------------------------------------------------- manifest

/**
 * A `package.json`, as much of one as this CLI reads.
 *
 * The index signature is what makes the spread in `generatePackageJson` honest:
 * the template's manifest is taken whole and only the fields below are touched.
 */
export interface PackageManifest {
	name?: string;
	version?: string;
	type?: string;
	private?: boolean;
	description?: string;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	[field: string]: unknown;
}

/** The two manifest fields this CLI merges dependencies into. */
export type DependencyField = "dependencies" | "devDependencies";

// --------------------------------------------------------------------- report

/** One line of the build check, pointing at a file and saying how to fix it. */
export interface Diagnostic {
	where: string;
	message: string;
	hint?: string;
}

/** The verdict of the build check. */
export interface Report {
	root: string;
	errors: Diagnostic[];
	warnings: Diagnostic[];
	readonly ok: boolean;
}

// ---------------------------------------------------------------------- shell

/**
 * Parsed command-line flags.
 *
 * The index signature is deliberate: `parseArgs` accepts any `--flag`, and the
 * named entries are the ones a command reads. A typo in a flag is not an error
 * worth failing a build over, so it lands here and is ignored.
 */
export interface Flags {
	template?: string;
	out?: string;
	name?: string;
	/** `init` only: where the app deploys, which decides its deploy config. */
	host?: string;
	force?: boolean;
	minimal?: boolean;
	yes?: boolean;
	install?: boolean;
	[flag: string]: string | boolean | undefined;
}

/**
 * A subprocess stream rewriter. `write` takes a chunk at whatever boundary it
 * arrived on; `flush` emits the partial line held when the stream closed.
 */
export interface LineFilter {
	write(chunk: string): void;
	flush(): void;
}

/**
 * One step of the framework's build, as its own step module describes them.
 *
 * Loaded by absolute path from outside the framework's `exports` map, so this
 * is a description of someone else's shape rather than a contract. `framework.ts`
 * checks it at runtime before trusting it.
 */
export interface BuildStep {
	label: string;
	run?: () => unknown;
	command?: string;
}
