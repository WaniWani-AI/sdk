/**
 * English catalog. Source of truth — every other locale must mirror this
 * shape exactly (the `Messages` type is inferred from here).
 */

export interface Messages {
	promptInput: {
		placeholder: string;
		uploadFiles: string;
		uploadFilesUpTo: string;
		stop: string;
		submit: string;
		removeAttachments: string;
		removeAttachment: string;
		uploading: string;
		retry: string;
		retryUpload: string;
		uploadFailed: string;
		dropToAttach: string;
		errorAccept: string;
		errorTooLarge: string;
		errorTooMany: string;
	};
	workingIndicator: {
		default: string;
	};
	reasoning: {
		thinking: string;
		thoughtBrief: string;
		thoughtForSeconds: (count: number) => string;
	};
	/** Chain-of-thought header (no icon): a generic label per state. */
	chainOfThought: {
		working: string;
		done: string;
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
		kindPdf: string;
		kindImage: string;
		kindFile: string;
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
		uploadFilesUpTo: "Upload a document, up to {limit}",
		stop: "Stop",
		submit: "Submit",
		removeAttachments: "Remove all attachments",
		removeAttachment: "Remove attachment",
		uploading: "Uploading…",
		retry: "Retry",
		retryUpload: "Retry the upload",
		uploadFailed: "The upload did not finish.",
		dropToAttach: "Drop to attach",
		errorAccept: "{name} is not a file type this chat accepts.",
		errorTooLarge: "{name} is larger than {limit}.",
		errorTooMany: "You can attach up to {limit} files.",
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
	chainOfThought: {
		working: "Working on it…",
		done: "Thought process",
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
		kindPdf: "PDF",
		kindImage: "Image",
		kindFile: "File",
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
		tooltip: "Save scenario to Waniwani",
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
