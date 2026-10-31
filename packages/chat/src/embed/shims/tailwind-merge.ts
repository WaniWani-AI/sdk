// Lightweight stub for tailwind-merge in the embed bundle.
// Since all styles are inside Shadow DOM with the ww: prefix,
// class conflicts with the host page are impossible. A simple
// concatenation is sufficient.
export function twMerge(...args: string[]) {
	return args.filter(Boolean).join(" ");
}
export function extendTailwindMerge() {
	return twMerge;
}
