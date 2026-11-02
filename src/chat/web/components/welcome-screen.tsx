"use client";

import { type CSSProperties, Fragment, useEffect, useState } from "react";
import type { AvatarIntro, WelcomeConfig } from "../@types";
import { cn } from "../lib/utils";
import { PARTS } from "../parts";
import { Avatar } from "./avatar";
import { RotatingText } from "./rotating-text";
import { Suggestions } from "./suggestions";

interface WelcomeScreenProps extends WelcomeConfig {
	onSuggestionSelect?: (suggestion: string) => void;
	variant?: "cards" | "pills";
	/** Whether the screen is visible yet; `data-appeared` waits for it. */
	appeared?: boolean;
	avatarIntro?: AvatarIntro;
}

export function WelcomeScreen({
	icon,
	title,
	description,
	subtitles,
	subtitleRotateMs = 0,
	suggestions,
	onSuggestionSelect,
	variant = "cards",
	appeared: onScreen = true,
	avatarIntro,
}: WelcomeScreenProps) {
	const [appeared, setAppeared] = useState(false);
	useEffect(() => {
		setAppeared(onScreen);
	}, [onScreen]);

	return (
		<div
			className={cn(
				PARTS.welcome,
				"ww:flex ww:flex-col ww:items-center ww:justify-center ww:py-12 ww:px-6 ww:text-center ww:min-h-full",
			)}
			data-appeared={appeared ? "true" : "false"}
		>
			{typeof icon === "string" && isImageUrl(icon) ? (
				<Avatar
					src={icon}
					slot="welcome"
					intro={avatarIntro}
					visible={onScreen}
					className="ww:mb-4"
				/>
			) : (
				icon && (
					<div className="ww:mb-4 ww:flex ww:items-center ww:justify-center ww:size-12 ww:rounded-xl ww:bg-foreground ww:text-background">
						{icon}
					</div>
				)
			)}
			<h2
				className={cn(
					PARTS.welcomeTitle,
					"ww:text-lg ww:font-semibold ww:text-foreground",
				)}
			>
				{variant === "pills" ? <TitleLines title={title} /> : title}
			</h2>
			{(Boolean(subtitles?.length) || Boolean(description)) && (
				<p
					className={cn(
						PARTS.welcomeSubtitle,
						"ww:mt-1 ww:text-sm ww:text-muted-foreground ww:max-w-sm",
					)}
				>
					{subtitles?.length ? (
						<RotatingText items={subtitles} intervalMs={subtitleRotateMs} />
					) : (
						description
					)}
				</p>
			)}
			{suggestions &&
				suggestions.length > 0 &&
				(variant === "pills" ? (
					<Suggestions
						suggestions={suggestions}
						origin="welcome"
						align="center"
						className={cn(PARTS.welcomeSuggestions, "ww:mt-4")}
						onSelect={(suggestion) => onSuggestionSelect?.(suggestion)}
					/>
				) : (
					<div
						className={cn(
							PARTS.welcomeSuggestions,
							"ww:mt-6 ww:w-full ww:max-w-md ww:flex ww:flex-col ww:gap-2",
						)}
					>
						{suggestions.map((suggestion, index) => (
							<button
								key={suggestion}
								type="button"
								onClick={() => onSuggestionSelect?.(suggestion)}
								data-origin="welcome"
								data-index={index}
								className={cn(
									PARTS.suggestion,
									"ww:w-full ww:text-left ww:rounded-xl ww:border ww:border-border ww:bg-background ww:px-4 ww:py-3 ww:text-sm",
									"ww:text-foreground ww:hover:bg-accent ww:hover:border-primary/30",
									"ww:transition-all ww:duration-200 ww:ease-out ww:cursor-pointer",
								)}
								style={{ "--ww-index": index } as CSSProperties}
							>
								{suggestion}
							</button>
						))}
					</div>
				))}
		</div>
	);
}

const IMAGE_URL_SCHEMES = ["http:", "https:", "data:", "blob:"];

/** A string icon is an image only when it reads as a URL or path; "👋" stays text. */
export function isImageUrl(value: string): boolean {
	return (
		IMAGE_URL_SCHEMES.some((scheme) => value.startsWith(scheme)) ||
		value.includes("/")
	);
}

function TitleLines({ title }: { title: string }) {
	return title.split("|").map((line, index) => (
		<Fragment key={index}>
			{index > 0 && <br />}
			{line}
		</Fragment>
	));
}
