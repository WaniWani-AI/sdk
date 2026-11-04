"use client";

import { Fragment, useEffect, useState } from "react";
import { cn } from "../lib/utils";

const SWAP_FADE_MS = 300;
const LINE_BREAK = /\\n|\r?\n/;

export interface RotatingTextProps {
	items: string[];
	intervalMs: number;
	className?: string;
}

/**
 * Cycles `items` every `intervalMs`, with `data-rotating="true"` on the
 * element for the {@link SWAP_FADE_MS} around each swap (text changes at the
 * midpoint). One item or an interval of `0` shows the first item, still.
 * A literal `\n` or a newline inside an item renders as a line break.
 */
export function RotatingText({
	items,
	intervalMs,
	className,
}: RotatingTextProps) {
	const [index, setIndex] = useState(0);
	const [rotating, setRotating] = useState(false);
	const rotates = items.length > 1 && intervalMs > 0;

	useEffect(() => {
		if (!rotates) {
			return;
		}
		const pending = new Set<ReturnType<typeof setTimeout>>();
		const later = (fn: () => void, ms: number) => {
			const id = setTimeout(() => {
				pending.delete(id);
				fn();
			}, ms);
			pending.add(id);
		};
		const interval = setInterval(() => {
			setRotating(true);
			later(() => setIndex((i) => (i + 1) % items.length), SWAP_FADE_MS / 2);
			later(() => setRotating(false), SWAP_FADE_MS);
		}, intervalMs);
		return () => {
			clearInterval(interval);
			for (const id of pending) {
				clearTimeout(id);
			}
		};
	}, [rotates, intervalMs, items.length]);

	return (
		<span
			className={cn(
				"ww:inline-block ww:transition-opacity ww:duration-150 ww:data-[rotating=true]:opacity-0",
				className,
			)}
			data-rotating={rotating ? "true" : undefined}
		>
			<ItemLines text={items[index % items.length] ?? ""} />
		</span>
	);
}

function ItemLines({ text }: { text: string }) {
	return text.split(LINE_BREAK).map((line, index) => (
		<Fragment key={index}>
			{index > 0 && <br />}
			{line}
		</Fragment>
	));
}
