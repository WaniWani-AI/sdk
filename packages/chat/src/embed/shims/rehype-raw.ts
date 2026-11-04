// Stub rehype-raw for embed bundle. Strips parse5 (~100KB).
// Raw HTML in markdown won't be processed, but basic markdown works fine.
export function raw() {
	return (tree: unknown) => tree;
}
export default raw;
