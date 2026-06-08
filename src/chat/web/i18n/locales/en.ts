/**
 * English catalog. Source of truth — every other locale must mirror this
 * shape exactly (the `Messages` type is inferred from here).
 */

export interface Messages {
	promptInput: {
		placeholder: string;
		uploadFiles: string;
		stop: string;
		submit: string;
		removeAttachments: string;
	};
	workingIndicator: {
		default: string;
	};
	reasoning: {
		thinking: string;
		thoughtBrief: string;
		thoughtForSeconds: (count: number) => string;
	};
	tool: {
		copy: string;
		copied: string;
		request: string;
		response: string;
		error: string;
	};
	attachments: {
		attachmentFallback: string;
		fileFallback: string;
	};
	threadMenu: {
		newChat: string;
		threadHistory: string;
		deleteThread: string;
		noPreviousChats: string;
		hiddenThreads: (count: number) => string;
	};
	chatQueue: {
		attachmentFallback: string;
		removeFromQueue: string;
		queued: (count: number) => string;
	};
	poweredBy: {
		label: string;
	};
	aiDisclaimer: {
		default: string;
	};
	exportSession: {
		saving: string;
		saved: string;
		error: string;
		export: string;
		tooltip: string;
	};
	widgetErrorBoundary: {
		failedToLoad: string;
		retry: string;
	};
	launcher: {
		prompt: string;
		open: string;
		close: string;
		minimize: string;
	};
}

export const en: Messages = {
	promptInput: {
		placeholder: "What would you like to know?",
		uploadFiles: "Upload files",
		stop: "Stop",
		submit: "Submit",
		removeAttachments: "Remove all attachments",
	},
	workingIndicator: {
		default: "On it…",
	},
	reasoning: {
		thinking: "Thinking…",
		thoughtBrief: "Thought for a few seconds",
		thoughtForSeconds: (count: number) =>
			`Thought for ${count} second${count === 1 ? "" : "s"}`,
	},
	tool: {
		copy: "Copy",
		copied: "Copied",
		request: "Request",
		response: "Response",
		error: "Error",
	},
	attachments: {
		attachmentFallback: "attachment",
		fileFallback: "file",
	},
	threadMenu: {
		newChat: "New chat",
		threadHistory: "Thread history",
		deleteThread: "Delete thread",
		noPreviousChats: "No previous chats yet.",
		hiddenThreads: (count: number) =>
			`${count} older thread${count === 1 ? "" : "s"} hidden`,
	},
	chatQueue: {
		attachmentFallback: "(attachment)",
		removeFromQueue: "Remove from queue",
		queued: (count: number) => `${count} queued`,
	},
	poweredBy: {
		label: "AI agent powered by",
	},
	aiDisclaimer: {
		default: "can make mistakes",
	},
	exportSession: {
		saving: "saving...",
		saved: "saved",
		error: "error",
		export: "export",
		tooltip: "Save scenario to WaniWani",
	},
	widgetErrorBoundary: {
		failedToLoad: "Widget failed to load",
		retry: "Retry",
	},
	launcher: {
		prompt: "Ask anything…",
		open: "Open chat",
		close: "Close chat",
		minimize: "Minimize",
	},
};
