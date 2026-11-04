import { useEffect, useMemo, useState } from "react";
import {
	type LocaleMessageOverrides,
	type MessageOverrides,
	mergeOverrideSources,
} from "../i18n";
import type { EmbedConfig } from "./config";
import { READINESS_TIMEOUT_MS } from "./remote-config";

type FetchedMessages = MessageOverrides | LocaleMessageOverrides;

/**
 * Fetches the wording overrides served at `url`. `ready` turns true once the
 * map arrives, the request fails, or {@link READINESS_TIMEOUT_MS} passes,
 * whichever comes first, so the chat can hold its first paint without
 * waiting on a stalled host. No `url` means nothing to wait for.
 */
export function useMessagesUrl(url: string | undefined): {
	messages: FetchedMessages | undefined;
	ready: boolean;
} {
	const [messages, setMessages] = useState<FetchedMessages | undefined>(
		undefined,
	);
	const [ready, setReady] = useState(!url);

	useEffect(() => {
		if (!url) {
			setReady(true);
			return;
		}
		setReady(false);
		const controller = new AbortController();
		const safety = setTimeout(() => setReady(true), READINESS_TIMEOUT_MS);
		const settle = (value: FetchedMessages | undefined) => {
			if (controller.signal.aborted) {
				return;
			}
			clearTimeout(safety);
			setMessages(value);
			setReady(true);
		};
		fetch(url, {
			headers: { Accept: "application/json" },
			credentials: "omit",
			signal: controller.signal,
		})
			.then(async (res) => {
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				const body: unknown = await res.json();
				if (typeof body !== "object" || body === null || Array.isArray(body)) {
					throw new Error("not a JSON object");
				}
				settle(body as FetchedMessages);
			})
			.catch((err) => {
				if (controller.signal.aborted) {
					return;
				}
				console.warn("[Waniwani] Could not load data-messages-url:", err);
				settle(undefined);
			});
		return () => {
			controller.abort();
			clearTimeout(safety);
		};
	}, [url]);

	return { messages, ready };
}

export interface EmbedMessages {
	messages: FetchedMessages | undefined;
	ready: boolean;
}

/**
 * The wording overrides an embed renders with: the inline `messages` layered
 * over the map fetched from `messagesUrl`, and whether that fetch has settled.
 */
export function useEmbedMessages(
	config: Pick<EmbedConfig, "messages" | "messagesUrl">,
): EmbedMessages {
	const { messages: fetched, ready } = useMessagesUrl(config.messagesUrl);
	const inline = config.messages;
	const messages = useMemo(
		() => mergeOverrideSources(fetched, inline),
		[fetched, inline],
	);
	return { messages, ready };
}
