import { useMemo } from "react";
import type { ChatBaseProps, ChatEmbedProps, WelcomeConfig } from "../@types";
import type { AvatarSlot, EmbedConfig } from "./config";

const DEFAULT_AVATAR_SLOTS: AvatarSlot[] = ["welcome", "header"];
const DEFAULT_AVATAR_INTRO_MS = 7000;

export function buildAvatar(
	config: EmbedConfig,
): ChatBaseProps["avatar"] | undefined {
	if (!config.avatar) {
		return undefined;
	}
	const avatar: NonNullable<ChatBaseProps["avatar"]> = {
		src: config.avatar,
		slots: config.avatarSlots ?? DEFAULT_AVATAR_SLOTS,
	};
	if (config.avatarIntro) {
		avatar.intro = {
			src: config.avatarIntro,
			durationMs: config.avatarIntroDuration ?? DEFAULT_AVATAR_INTRO_MS,
		};
	}
	return avatar;
}

/**
 * The structured welcome from `data-welcome-*`. Its icon and chips are filled
 * in by `ChatEmbed`, which owns the avatar slots and the resolved pill row.
 */
export function buildWelcome(config: EmbedConfig): WelcomeConfig | undefined {
	if (!config.welcomeTitle) {
		return undefined;
	}
	const subtitles = config.welcomeSubtitle;
	return {
		title: config.welcomeTitle,
		description: subtitles?.[0],
		subtitles,
		subtitleRotateMs: config.welcomeSubtitleRotate,
	};
}

/** The welcome and avatar props every embed mode hands `ChatEmbed`. */
export function useEmbedWelcomeProps(
	config: EmbedConfig,
): Pick<ChatEmbedProps, "welcome" | "avatar" | "welcomeVariant"> {
	return useMemo(
		() => ({
			welcome: buildWelcome(config),
			avatar: buildAvatar(config),
			welcomeVariant: "pills",
		}),
		[config],
	);
}
