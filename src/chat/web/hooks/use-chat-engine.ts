"use client";

import { useChat } from "@ai-sdk/react";
import type { FileUIPart, UIMessage } from "ai";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelContextUpdate } from "../../../shared/model-context";
import { hasModelContext } from "../../../shared/model-context";
import type { ChatBaseProps } from "../@types";
import type { PromptInputMessage } from "../ai-elements/prompt-input";
import { LenientChatTransport } from "../lib/lenient-chat-transport";
import {
	deleteThread as deleteThreadFromStore,
	deriveThreadTitle,
	getActiveThreadId,
	listThreads,
	loadThread,
	type StoredThread,
	upsertThread,
} from "../lib/thread-store";
import type { VisitorContext } from "../lib/visitor-context";
import { collectVisitorContext } from "../lib/visitor-context";

const SESSION_HEADER_NAME = "x-session-id";
const THREAD_PERSIST_DEBOUNCE_MS = 250;

function generateThreadId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return nanoid();
}

function nowIso(): string {
	return new Date().toISOString();
}

function normalizeSessionId(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export interface QueuedMessage {
	id: string;
	text: string;
	files: FileUIPart[];
	modelContext?: ModelContextUpdate;
}

/**
 * Per-tool definition metadata, keyed by tool name. The chat UI caches the
 * MCP `tools/list` response here so widget resolution
 * (`_meta.ui.resourceUri`, `_meta["openai/outputTemplate"]`, etc.) can
 * happen by tool name, per MCP Apps spec. This is the browser-side
 * equivalent of what a stateful MCP host (e.g. Claude Desktop, MCP Jam)
 * caches for the lifetime of its MCP session.
 */
export type ToolDefinitionsMap = Record<
	string,
	{
		name: string;
		title?: string;
		description?: string;
		_meta?: Record<string, unknown>;
	}
>;

interface ToolsListResponse {
	tools: Array<{
		name: string;
		title?: string;
		description?: string;
		_meta?: Record<string, unknown>;
	}>;
}

async function fetchToolDefinitions(
	api: string,
	headers?: Record<string, string>,
): Promise<ToolDefinitionsMap> {
	const url = `${api.replace(/\/$/, "")}/tools`;
	const response = await fetch(url, {
		method: "GET",
		headers: headers ? { ...headers } : undefined,
	});
	if (!response.ok) {
		throw new Error(
			`[WaniWani] Failed to fetch /tools: ${response.status} ${response.statusText}`,
		);
	}
	const data = (await response.json()) as ToolsListResponse;
	if (!data || !Array.isArray(data.tools)) {
		return {};
	}
	const map: ToolDefinitionsMap = {};
	for (const tool of data.tools) {
		if (tool && typeof tool.name === "string") {
			map[tool.name] = tool;
		}
	}
	return map;
}

type ChatEngineMessage = PromptInputMessage & {
	modelContext?: ModelContextUpdate;
};

export function useChatEngine(props: ChatBaseProps) {
	const {
		api = "/api/waniwani",
		headers: userHeaders,
		body,
		onMessageSent,
		onResponseReceived,
		enableThreadHistory = true,
		activeThreadId: controlledThreadId,
		onThreadChange,
	} = props;

	const headersRef = useRef(userHeaders);
	const bodyRef = useRef(body);
	const pendingModelContextRef = useRef<ModelContextUpdate | undefined>(
		undefined,
	);
	const visitorContextRef = useRef<VisitorContext | null>(null);
	const [sessionId, setSessionIdState] = useState<string | undefined>(
		undefined,
	);
	const sessionIdRef = useRef<string | undefined>(sessionId);

	const [activeThreadId, setActiveThreadIdState] = useState<string | undefined>(
		controlledThreadId,
	);
	const activeThreadIdRef = useRef<string | undefined>(activeThreadId);
	const [threads, setThreads] = useState<StoredThread[]>([]);
	const [isThreadHistoryReady, setIsThreadHistoryReady] = useState(
		!enableThreadHistory,
	);
	const threadCreatedAtRef = useRef<string | undefined>(undefined);
	const threadTitleRef = useRef<string | undefined>(undefined);
	const persistTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const onThreadChangeRef = useRef(onThreadChange);
	useEffect(() => {
		onThreadChangeRef.current = onThreadChange;
	}, [onThreadChange]);

	const setActiveThreadId = useCallback((next: string | undefined) => {
		activeThreadIdRef.current = next;
		setActiveThreadIdState(next);
		if (next) {
			onThreadChangeRef.current?.(next);
		}
	}, []);

	const refreshThreads = useCallback(async () => {
		if (!enableThreadHistory) {
			return;
		}
		const memoryUserId = visitorContextRef.current?.memoryUserId;
		if (!memoryUserId) {
			return;
		}
		const list = await listThreads(memoryUserId);
		setThreads(list);
	}, [enableThreadHistory]);

	const getSessionId = useCallback((): string | undefined => {
		return sessionIdRef.current;
	}, []);

	const setSessionId = useCallback((value: unknown) => {
		const sessionId = normalizeSessionId(value);
		if (!sessionId) {
			return;
		}
		if (sessionIdRef.current === sessionId) {
			return;
		}

		sessionIdRef.current = sessionId;
		setSessionIdState(sessionId);
	}, []);

	const clearSessionId = useCallback(() => {
		sessionIdRef.current = undefined;
		setSessionIdState(undefined);
	}, []);

	useEffect(() => {
		headersRef.current = userHeaders;
	}, [userHeaders]);

	useEffect(() => {
		bodyRef.current = body;
	}, [body]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const ctx = await collectVisitorContext();
				if (cancelled) {
					return;
				}
				visitorContextRef.current = ctx;
			} catch {
				// Best-effort — silently ignore failures
			}

			if (!enableThreadHistory) {
				return;
			}
			const memoryUserId = visitorContextRef.current?.memoryUserId;
			if (!memoryUserId) {
				setIsThreadHistoryReady(true);
				return;
			}

			try {
				const targetId =
					controlledThreadId ?? (await getActiveThreadId(memoryUserId));
				if (cancelled) {
					return;
				}
				if (targetId) {
					const stored = await loadThread(targetId);
					if (cancelled) {
						return;
					}
					if (stored && stored.memoryUserId === memoryUserId) {
						activeThreadIdRef.current = stored.threadId;
						setActiveThreadIdState(stored.threadId);
						threadCreatedAtRef.current = stored.createdAt;
						threadTitleRef.current = stored.title;
						if (stored.sessionId) {
							sessionIdRef.current = stored.sessionId;
							setSessionIdState(stored.sessionId);
						}
						setMessages(stored.messages);
					}
				}
				await refreshThreads();
			} finally {
				if (!cancelled) {
					setIsThreadHistoryReady(true);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const transportRef = useRef(
		new LenientChatTransport({
			api,
			headers: () => ({
				...headersRef.current,
			}),
			body: () => {
				const resolvedBody = {
					...(bodyRef.current ?? {}),
				};

				const hasExplicitSessionId = Object.hasOwn(resolvedBody, "sessionId");
				const bodySessionId = normalizeSessionId(resolvedBody.sessionId);
				if (bodySessionId) {
					setSessionId(bodySessionId);
					resolvedBody.sessionId = bodySessionId;
				} else if (hasExplicitSessionId) {
					clearSessionId();
					delete resolvedBody.sessionId;
				} else {
					const storedSessionId = getSessionId();
					if (storedSessionId) {
						resolvedBody.sessionId = storedSessionId;
					}
				}

				if (hasModelContext(pendingModelContextRef.current)) {
					resolvedBody.modelContext = pendingModelContextRef.current;
				}

				if (visitorContextRef.current) {
					const vc = visitorContextRef.current;
					resolvedBody.visitorContext = {
						timezone: vc.timezone,
						language: vc.language,
						languages: vc.languages,
						deviceType: vc.deviceType,
						referrer: vc.referrer,
						visitorId: vc.visitorId,
					};
					const existingVisitor =
						typeof resolvedBody.visitor === "object" &&
						resolvedBody.visitor !== null
							? (resolvedBody.visitor as Record<string, unknown>)
							: {};
					const existingClient =
						typeof existingVisitor.client === "object" &&
						existingVisitor.client !== null
							? (existingVisitor.client as Record<string, unknown>)
							: {};
					resolvedBody.visitor = {
						...existingVisitor,
						client: {
							...existingClient,
							memoryUserId: vc.memoryUserId,
						},
					};
				}

				if (enableThreadHistory) {
					const hasExplicitThreadId = Object.hasOwn(resolvedBody, "threadId");
					if (!hasExplicitThreadId) {
						let tid = activeThreadIdRef.current;
						if (!tid) {
							tid = generateThreadId();
							threadCreatedAtRef.current = nowIso();
							threadTitleRef.current = undefined;
							setActiveThreadId(tid);
						}
						resolvedBody.threadId = tid;
					} else if (typeof resolvedBody.threadId === "string") {
						activeThreadIdRef.current = resolvedBody.threadId;
					}
				}

				return resolvedBody;
			},
			fetch: (async (input, init) => {
				const response = await fetch(input, init);
				pendingModelContextRef.current = undefined;
				setSessionId(response.headers.get(SESSION_HEADER_NAME));
				return response;
			}) as typeof fetch,
		}),
	);

	const pendingWaitRef = useRef<{
		resolve: (msg: unknown) => void;
		reject: (err: Error) => void;
	} | null>(null);
	const finishedMessageRef = useRef<unknown>(null);

	// Tool catalog cached for the lifetime of this ChatCard mount. Fetched
	// once on mount via GET /api/waniwani/tools (spec: the host calls
	// tools/list once per session and caches the result). A mutation counter
	// drives re-renders when the catalog refreshes without making the whole
	// ref reactive.
	const toolDefinitionsRef = useRef<ToolDefinitionsMap>({});
	const [toolDefinitionsRevision, setToolDefinitionsRevision] = useState(0);

	const skipRemoteConfig = props.skipRemoteConfig === true;

	const refreshToolDefinitions = useCallback(async () => {
		if (skipRemoteConfig) {
			return;
		}
		try {
			const map = await fetchToolDefinitions(api, headersRef.current);
			toolDefinitionsRef.current = map;
			setToolDefinitionsRevision((r) => r + 1);
		} catch (error) {
			console.warn(
				"[WaniWani] Failed to fetch tool definitions:",
				error instanceof Error ? error.message : error,
			);
		}
	}, [api, skipRemoteConfig]);

	useEffect(() => {
		void refreshToolDefinitions();
	}, [refreshToolDefinitions]);

	const { messages, sendMessage, setMessages, status } = useChat({
		messages: props.initialMessages,
		transport: transportRef.current,
		onFinish({ message }) {
			onResponseReceived?.();
			if (pendingWaitRef.current) {
				// Stash the message — resolve only after React commits the
				// messages state update (see useEffect on `status` below).
				finishedMessageRef.current = message;
			}
		},
		onError(error) {
			console.warn("[WaniWani] Chat error:", error.message);
			if (pendingWaitRef.current) {
				pendingWaitRef.current.reject(error);
				pendingWaitRef.current = null;
			}
		},
	});

	const messagesRef = useRef<UIMessage[]>(messages);
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	// Resolve sendMessageAndWait only after React has committed the messages
	// state update. `onFinish` fires before the re-render, so resolving there
	// would expose stale `messages` to the caller.
	useEffect(() => {
		if (
			status === "ready" &&
			pendingWaitRef.current &&
			finishedMessageRef.current
		) {
			const pending = pendingWaitRef.current;
			const message = finishedMessageRef.current;
			pendingWaitRef.current = null;
			finishedMessageRef.current = null;
			pending.resolve(message);
		}
	}, [status]);

	const [text, setText] = useState("");
	const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);

	const isLoading = status === "submitted" || status === "streaming";

	const removeQueuedMessage = useCallback((id: string) => {
		setQueuedMessages((prev) => prev.filter((m) => m.id !== id));
	}, []);

	const queueFull = isLoading && queuedMessages.length > 0;

	const handleSubmit = useCallback(
		(message: ChatEngineMessage) => {
			const hasText = Boolean(message.text?.trim());
			const hasFiles = Boolean(message.files?.length);
			if (!(hasText || hasFiles)) {
				return;
			}

			if (isLoading) {
				// Only allow one queued message at a time
				if (queuedMessages.length > 0) {
					return;
				}

				setQueuedMessages((prev) => [
					...prev,
					{
						id: nanoid(),
						text: message.text || "",
						files: message.files ?? [],
						modelContext: message.modelContext,
					},
				]);
				setText("");
				return;
			}

			pendingModelContextRef.current = message.modelContext;
			sendMessage({
				text: message.text || "",
				files: message.files,
			});

			onMessageSent?.(message.text || "");
			setText("");
		},
		[sendMessage, onMessageSent, isLoading, queuedMessages.length],
	);

	const sendMessageAndWait = useCallback(
		(text: string): Promise<unknown> => {
			return new Promise((resolve, reject) => {
				pendingWaitRef.current = { resolve, reject };
				sendMessage({ text });
				onMessageSent?.(text);
			});
		},
		[sendMessage, onMessageSent],
	);

	// Flush first queued message once the current response finishes
	useEffect(() => {
		if (status !== "ready") {
			return;
		}
		if (queuedMessages.length === 0) {
			return;
		}

		const [first, ...rest] = queuedMessages;
		setQueuedMessages(rest);

		pendingModelContextRef.current = first.modelContext;
		sendMessage({
			text: first.text,
			files: first.files.length > 0 ? first.files : undefined,
		});
		onMessageSent?.(first.text);
	}, [status, sendMessage, onMessageSent, queuedMessages]);

	const reset = useCallback(() => {
		setMessages([]);
		setQueuedMessages([]);
		clearSessionId();
		setText("");
		toolDefinitionsRef.current = {};
		setToolDefinitionsRevision((r) => r + 1);
		void refreshToolDefinitions();
	}, [setMessages, clearSessionId, refreshToolDefinitions]);

	const persistActiveThread = useCallback(async () => {
		if (!enableThreadHistory) {
			return;
		}
		const memoryUserId = visitorContextRef.current?.memoryUserId;
		const threadId = activeThreadIdRef.current;
		const msgs = messagesRef.current;
		if (!memoryUserId || !threadId || msgs.length === 0) {
			return;
		}
		if (!threadCreatedAtRef.current) {
			threadCreatedAtRef.current = nowIso();
		}
		if (!threadTitleRef.current) {
			const firstUser = msgs.find((m) => m.role === "user");
			const firstUserText = firstUser
				? firstUser.parts
						.map((p) =>
							"text" in p && typeof p.text === "string" ? p.text : "",
						)
						.join(" ")
				: "";
			threadTitleRef.current = deriveThreadTitle(firstUserText);
		}
		const stored: StoredThread = {
			threadId,
			memoryUserId,
			title: threadTitleRef.current,
			messages: msgs,
			sessionId: sessionIdRef.current,
			createdAt: threadCreatedAtRef.current,
			updatedAt: nowIso(),
		};
		await upsertThread(stored);
		await refreshThreads();
	}, [enableThreadHistory, refreshThreads]);

	useEffect(() => {
		if (!enableThreadHistory) {
			return;
		}
		if (!isThreadHistoryReady) {
			return;
		}
		if (status === "submitted" || status === "streaming") {
			return;
		}
		if (messages.length === 0) {
			return;
		}
		if (persistTimerRef.current) {
			clearTimeout(persistTimerRef.current);
		}
		persistTimerRef.current = setTimeout(() => {
			void persistActiveThread();
		}, THREAD_PERSIST_DEBOUNCE_MS);
		return () => {
			if (persistTimerRef.current) {
				clearTimeout(persistTimerRef.current);
			}
		};
	}, [
		enableThreadHistory,
		isThreadHistoryReady,
		messages,
		status,
		persistActiveThread,
	]);

	const startNewThread = useCallback(() => {
		if (persistTimerRef.current) {
			clearTimeout(persistTimerRef.current);
			persistTimerRef.current = undefined;
		}
		setMessages([]);
		setQueuedMessages([]);
		clearSessionId();
		setText("");
		const nextId = generateThreadId();
		threadCreatedAtRef.current = nowIso();
		threadTitleRef.current = undefined;
		setActiveThreadId(nextId);
		void refreshThreads();
		return nextId;
	}, [setMessages, clearSessionId, setActiveThreadId, refreshThreads]);

	const switchThread = useCallback(
		async (threadId: string) => {
			if (persistTimerRef.current) {
				clearTimeout(persistTimerRef.current);
				persistTimerRef.current = undefined;
			}
			const stored = await loadThread(threadId);
			if (!stored) {
				return;
			}
			setActiveThreadId(stored.threadId);
			threadCreatedAtRef.current = stored.createdAt;
			threadTitleRef.current = stored.title;
			if (stored.sessionId) {
				sessionIdRef.current = stored.sessionId;
				setSessionIdState(stored.sessionId);
			} else {
				clearSessionId();
			}
			setMessages(stored.messages);
			setQueuedMessages([]);
			setText("");
		},
		[setMessages, clearSessionId, setActiveThreadId],
	);

	const deleteThread = useCallback(
		async (threadId: string) => {
			await deleteThreadFromStore(threadId);
			await refreshThreads();
			if (activeThreadIdRef.current === threadId) {
				if (persistTimerRef.current) {
					clearTimeout(persistTimerRef.current);
					persistTimerRef.current = undefined;
				}
				setMessages([]);
				clearSessionId();
				setText("");
				activeThreadIdRef.current = undefined;
				setActiveThreadIdState(undefined);
				threadCreatedAtRef.current = undefined;
				threadTitleRef.current = undefined;
			}
		},
		[setMessages, clearSessionId, refreshThreads],
	);

	const handleTextChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			setText(e.target.value);
		},
		[],
	);

	const lastMessage = messages[messages.length - 1];
	const hasMessages = messages.length > 0;
	const showLoaderBubble =
		isLoading && (!hasMessages || lastMessage.role === "user");

	// Read through the revision counter so consumers (MessageList) re-render
	// when the catalog refreshes. Taking a snapshot here keeps the returned
	// object referentially stable between revisions.
	void toolDefinitionsRevision;
	const toolDefinitions = toolDefinitionsRef.current;

	return {
		messages,
		status,
		text,
		setText,
		handleSubmit,
		handleTextChange,
		isLoading,
		showLoaderBubble,
		lastMessage,
		hasMessages,
		sendMessage,
		sendMessageAndWait,
		reset,
		queuedMessages,
		queueFull,
		removeQueuedMessage,
		sessionId,
		toolDefinitions,
		refreshToolDefinitions,
		threads,
		activeThreadId,
		isThreadHistoryReady,
		startNewThread,
		switchThread,
		deleteThread,
	};
}
