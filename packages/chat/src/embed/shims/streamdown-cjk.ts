// Lightweight stub for @streamdown/cjk in the embed bundle.
export const cjk = {
	name: "cjk-noop",
	type: "cjk",
	remarkPluginsBefore: [],
	remarkPluginsAfter: [],
	remarkPlugins: [],
};

export function createCjkPlugin() {
	return cjk;
}
