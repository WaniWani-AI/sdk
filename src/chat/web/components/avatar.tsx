"use client";

import { useEffect, useRef, useState } from "react";
import type { AvatarIntro, AvatarSlot } from "../@types";
import { HOOKS } from "../hooks-contract";
import { cn } from "../lib/utils";

export type { AvatarIntro, AvatarSlot };

export interface AvatarProps {
	src: string;
	slot: AvatarSlot;
	intro?: AvatarIntro;
	/** Whether the slot is on screen; the intro waits for it. Defaults to true. */
	visible?: boolean;
	className?: string;
}

type IntroPhase = "waiting" | "playing" | "done";

const playedIntros = new Set<string>();

/** Forgets which intros already played, so a test can watch one again. */
export function resetAvatarIntros(): void {
	playedIntros.clear();
}

function introKey(intro: AvatarIntro, slot: AvatarSlot): string {
	return `${slot}:${intro.src}`;
}

function prefersReducedMotion(): boolean {
	return (
		typeof matchMedia === "function" &&
		matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function canPlay(intro: AvatarIntro | undefined, slot: AvatarSlot): boolean {
	return (
		intro !== undefined &&
		slot !== "message" &&
		!playedIntros.has(introKey(intro, slot)) &&
		!prefersReducedMotion()
	);
}

function initialPhase(
	intro: AvatarIntro | undefined,
	slot: AvatarSlot,
	visible: boolean,
): IntroPhase {
	if (!canPlay(intro, slot)) {
		return "done";
	}
	return visible ? "playing" : "waiting";
}

export function Avatar({
	src,
	slot,
	intro,
	visible = true,
	className,
}: AvatarProps) {
	const [failed, setFailed] = useState(false);
	const [phase, setPhase] = useState<IntroPhase>(() =>
		initialPhase(intro, slot, visible),
	);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => {
		if (phase === "waiting" && visible) {
			setPhase(canPlay(intro, slot) ? "playing" : "done");
		}
	}, [phase, visible, intro, slot]);
	useEffect(() => {
		if (phase === "playing" && intro) {
			playedIntros.add(introKey(intro, slot));
		}
	}, [phase, intro, slot]);
	useEffect(() => () => clearTimeout(timer.current), []);

	if (failed) {
		return null;
	}
	const showIntro = phase === "playing" && intro !== undefined;
	return (
		<img
			className={cn(
				HOOKS.avatar,
				"ww:size-[var(--ww-avatar-size)] ww:shrink-0 ww:rounded-full ww:object-cover",
				className,
			)}
			data-slot={slot}
			data-intro={showIntro ? "true" : undefined}
			src={showIntro ? intro.src : src}
			alt=""
			onLoad={() => {
				if (!showIntro) {
					return;
				}
				clearTimeout(timer.current);
				timer.current = setTimeout(() => setPhase("done"), intro.durationMs);
			}}
			onError={() => (showIntro ? setPhase("done") : setFailed(true))}
		/>
	);
}

/** The avatar's src when `slot` is one of its configured slots. */
export function avatarFor(
	avatar: { src: string; slots: AvatarSlot[] } | undefined,
	slot: AvatarSlot,
): string | undefined {
	return avatar?.slots.includes(slot) ? avatar.src : undefined;
}
