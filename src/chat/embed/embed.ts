import React from "react";
import { createRoot } from "react-dom/client";
import type { ChatEmbedConfig } from "../@types";
import { ChatWidget } from "../components/chat-widget";
import { buildStyleSheet } from "../styles";

interface ChatInstance {
	destroy: () => void;
}

function init(config: ChatEmbedConfig): ChatInstance {
	const container = config.container ?? document.body;

	// Create host element
	const host = document.createElement("div");
	host.id = "waniwani-chat-root";
	container.appendChild(host);

	// Attach Shadow DOM for style isolation
	const shadow = host.attachShadow({ mode: "open" });

	// Inject styles into shadow root
	const styleEl = document.createElement("style");
	styleEl.textContent = buildStyleSheet();
	shadow.appendChild(styleEl);

	// Mount point inside shadow DOM
	const mountPoint = document.createElement("div");
	shadow.appendChild(mountPoint);

	// Render React inside shadow DOM
	const root = createRoot(mountPoint);
	const { container: _container, ...widgetProps } = config;

	root.render(
		React.createElement(ChatWidget, {
			...widgetProps,
			_shadowRoot: shadow,
		}),
	);

	return {
		destroy() {
			root.unmount();
			host.remove();
		},
	};
}

// Auto-init from script data attributes
function autoInit() {
	const script = document.currentScript as HTMLScriptElement | null;
	if (!script) return;

	const apiKey = script.dataset.apiKey;
	const api = script.dataset.api;
	const title = script.dataset.title;
	const subtitle = script.dataset.subtitle;
	const welcomeMessage = script.dataset.welcomeMessage;
	const primaryColor = script.dataset.primaryColor;

	if (apiKey || api) {
		init({
			apiKey,
			api,
			title,
			subtitle,
			welcomeMessage,
			theme: primaryColor ? { primaryColor } : undefined,
		});
	}
}

// Expose on window
declare global {
	interface Window {
		WaniWani?: {
			chat?: {
				init: typeof init;
			};
		};
	}
}

window.WaniWani = window.WaniWani || {};
window.WaniWani.chat = { init };

// Auto-init if data attributes present
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", autoInit);
} else {
	autoInit();
}
