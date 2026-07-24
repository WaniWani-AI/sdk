"use client";

import { useChat } from "@ai-sdk/react";
import type { FileUIPart, UIMessage } from "ai";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelContextUpdate } from "../../../shared/model-context";
import { hasModelContext } from "../../../shared/model-context";
import type { ChatBaseProps } from "../@types";
import type { PromptInputMessage } from "../ai-elements/prompt-input";
import { buildApiUrl } from "../lib/api-url";
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
import {
	applyVisitorId,
	collectVisitorContext,
	getOrCreateVisitorId,
} from "../lib/visitor-context";

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
	const url = buildApiUrl(api, "/tools");
	const response = await fetch(url, {
		method: "GET",
		headers: headers ? { ...headers } : undefined,
	});
	if (!response.ok) {
		throw new Error(
			`[Waniwani] Failed to fetch /tools: ${response.status} ${response.statusText}`,
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
		enableThreadHistory = false,
		activeThreadId: controlledThreadId,
		onThreadChange,
	} = props;

	// Seed a host-supplied visitor id (e.g. the PostHog / Amplitude distinct id)
	// so every request correlates to the id the host site already tracks. Read
	// live per request downstream, so a changed value takes effect on the next
	// send. Accepts a literal or a sync/async resolver; a blank/failed result is
	// ignored, keeping the auto id. The returned cancel drops a late async result
	// after unmount or a value change. Pass a stable reference (e.g. `useCallback`)
	// for an expensive async resolver so it isn't re-invoked on every render.
	const propVisitorId = props.visitorId;
	useEffect(() => applyVisitorId(propVisitorId), [propVisitorId]);

	const headersRef = useRef(userHeaders);
	const bodyRef = useRef(body);
	const enableThreadHistoryRef = useRef(enableThreadHistory);
	useEffect(() => {
		enableThreadHistoryRef.current = enableThreadHistory;
	}, [enableThreadHistory]);
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
	// In-flight `upsertThread` promise. Tracked so callers (delete, flush)
	// can await an already-fired persist and avoid resurrect-after-delete
	// races, which `clearTimeout` alone cannot.
	const persistInflightRef = useRef<Promise<void> | undefined>(undefined);
	// Monotonic epoch invalidator for `switchThread`. Any concurrent
	// `startNewThread` / `switchThread` / `deleteThread` (on the active
	// thread) bumps this so a slower in-flight `loadThread` can't clobber
	// a newer thread's state when it eventually resolves.
	const switchEpochRef = useRef(0);
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
		// Snapshot epoch at mount. Any user action (startNewThread,
		// switchThread, deleteThread on active) bumps it; we then skip
		// applying the stale mount-load result.
		const mountEpoch = switchEpochRef.current;
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
				if (cancelled || mountEpoch !== switchEpochRef.current) {
					return;
				}
				if (targetId) {
					const stored = await loadThread(targetId);
					if (cancelled || mountEpoch !== switchEpochRef.current) {
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

				// Resolve the visitor id synchronously so it is present on the very
				// first request, before the async `collectVisitorContext()` in the
				// mount effect has resolved. The full context (device/client fields)
				// enriches the body once available, but never gates the id. Read it
				// live (not the cached `vc.visitorId`) so a host-supplied override
				// via `setVisitorId()` takes effect on the next request.
				const vc = visitorContextRef.current;
				const visitorId = getOrCreateVisitorId();
				if (vc) {
					resolvedBody.visitorContext = {
						timezone: vc.timezone,
						language: vc.language,
						languages: vc.languages,
						deviceType: vc.deviceType,
						referrer: vc.referrer,
						visitorId,
					};
				}
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
					// Anonymous visitor id — the server stamps it onto chat events'
					// `visitor_id` so visits link a `page.viewed` to its conversation.
					id: visitorId,
					client: {
						...existingClient,
						...(vc && { memoryUserId: vc.memoryUserId }),
					},
				};

				// Auto-inject SDK-managed identifiers into `extra` so the upstream
				// API forwards them to MCP `_meta["waniwani/extra"]`.
				// Caller-supplied `body.extra` keys win on collision.
				const callerExtra =
					typeof resolvedBody.extra === "object" &&
					resolvedBody.extra !== null &&
					!Array.isArray(resolvedBody.extra)
						? (resolvedBody.extra as Record<string, unknown>)
						: undefined;
				const memoryUserId = visitorContextRef.current?.memoryUserId;
				const locale = visitorContextRef.current?.language;
				const autoExtra: Record<string, unknown> = {};
				if (memoryUserId) {
					autoExtra.memoryUserId = memoryUserId;
				}
				if (locale) {
					autoExtra.locale = locale;
				}
				if (Object.keys(autoExtra).length > 0 || callerExtra) {
					resolvedBody.extra = {
						...autoExtra,
						...(callerExtra ?? {}),
					};
				}

				if (enableThreadHistoryRef.current) {
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
				"[Waniwani] Failed to fetch tool definitions:",
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
			console.warn("[Waniwani] Chat error:", error.message);
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

	// Hydrate persisted history when it's enabled *after* mount — commonly via
	// the remote embed config (the dashboard toggle, not a data-attr/prop). The
	// mount effect above ran while history was off and skipped loading, and
	// never re-runs, so a returning visitor's thread would otherwise never
	// appear. Handle the off→on transition here.
	//
	// Only hydrate into an empty chat: never clobber a conversation the visitor
	// started while history was off (those messages live in this same engine).
	// Mirrors the mount effect's load (epoch- and cancel-guarded). Runs once —
	// the ref starts `true` when history was already on at mount (handled there).
	const lateHydratedHistoryRef = useRef(enableThreadHistory);
	// biome-ignore lint/correctness/useExhaustiveDependencies: react to the enableThreadHistory transition only
	useEffect(() => {
		if (!enableThreadHistory || lateHydratedHistoryRef.current) {
			return;
		}
		lateHydratedHistoryRef.current = true;
		if (messagesRef.current.length > 0) {
			return;
		}
		let cancelled = false;
		const epoch = switchEpochRef.current;
		setIsThreadHistoryReady(false);
		(async () => {
			try {
				let ctx = visitorContextRef.current;
				if (!ctx) {
					try {
						ctx = await collectVisitorContext();
						visitorContextRef.current = ctx;
					} catch {
						// Best-effort — silently ignore failures
					}
				}
				const memoryUserId = ctx?.memoryUserId;
				if (!memoryUserId || cancelled || epoch !== switchEpochRef.current) {
					if (!cancelled) {
						setIsThreadHistoryReady(true);
					}
					return;
				}
				const targetId =
					controlledThreadId ?? (await getActiveThreadId(memoryUserId));
				if (cancelled || epoch !== switchEpochRef.current) {
					return;
				}
				if (targetId) {
					const stored = await loadThread(targetId);
					if (cancelled || epoch !== switchEpochRef.current) {
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
	}, [enableThreadHistory]);

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

	// Build a `StoredThread` from current refs synchronously. Callers that
	// need to flush before mutating thread state (startNewThread,
	// switchThread, deleteThread) must snapshot here *before* any `await`
	// or ref mutation, so the write describes the outgoing thread, not a
	// half-mutated mix of old + new.
	const buildPersistSnapshot = useCallback((): StoredThread | undefined => {
		if (!enableThreadHistoryRef.current) {
			return undefined;
		}
		const memoryUserId = visitorContextRef.current?.memoryUserId;
		const threadId = activeThreadIdRef.current;
		const msgs = messagesRef.current;
		if (!memoryUserId || !threadId || msgs.length === 0) {
			return undefined;
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
		return {
			threadId,
			memoryUserId,
			title: threadTitleRef.current,
			messages: msgs,
			sessionId: sessionIdRef.current,
			createdAt: threadCreatedAtRef.current,
			updatedAt: nowIso(),
		};
	}, []);

	const persistActiveThread = useCallback(async () => {
		const snap = buildPersistSnapshot();
		if (!snap) {
			return;
		}
		await upsertThread(snap);
		await refreshThreads();
	}, [buildPersistSnapshot, refreshThreads]);

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
			persistTimerRef.current = undefined;
			const p = persistActiveThread().finally(() => {
				if (persistInflightRef.current === p) {
					persistInflightRef.current = undefined;
				}
			});
			persistInflightRef.current = p;
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

	// Flush in-flight + pending persist. The snapshot is captured *now*
	// (synchronously) so callers can mutate thread refs immediately after
	// invoking this without tainting the outgoing write — even when an
	// in-flight persist forces the async tail to yield first.
	const flushPendingPersist = useCallback((): Promise<void> => {
		const inflight = persistInflightRef.current;
		const timer = persistTimerRef.current;
		const snap = timer ? buildPersistSnapshot() : undefined;
		if (timer) {
			clearTimeout(timer);
			persistTimerRef.current = undefined;
		}
		return (async () => {
			if (inflight) {
				await inflight;
			}
			if (snap) {
				await upsertThread(snap);
				await refreshThreads();
			}
		})();
	}, [buildPersistSnapshot, refreshThreads]);

	const startNewThread = useCallback(() => {
		// Bump epoch first so any in-flight `switchThread` load knows it's
		// been invalidated and skips its setters when it eventually resolves.
		switchEpochRef.current += 1;
		// Fire-and-forget: `flushPendingPersist` snapshots synchronously
		// before any await, so subsequent ref mutations below don't taint
		// the outgoing write.
		void flushPendingPersist();
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
	}, [
		setMessages,
		clearSessionId,
		setActiveThreadId,
		refreshThreads,
		flushPendingPersist,
	]);

	const switchThread = useCallback(
		async (threadId: string) => {
			switchEpochRef.current += 1;
			const epoch = switchEpochRef.current;
			await flushPendingPersist();
			if (epoch !== switchEpochRef.current) {
				return;
			}
			const stored = await loadThread(threadId);
			if (epoch !== switchEpochRef.current) {
				return;
			}
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
		[setMessages, clearSessionId, setActiveThreadId, flushPendingPersist],
	);

	const deleteThread = useCallback(
		async (threadId: string) => {
			// Drop pending + await in-flight persist for the thread we're
			// deleting — otherwise an already-fired `upsertThread` can settle
			// after `deleteThreadFromStore` and resurrect the row.
			if (activeThreadIdRef.current === threadId) {
				// Invalidate any in-flight `switchThread` targeting this thread.
				switchEpochRef.current += 1;
				if (persistTimerRef.current) {
					clearTimeout(persistTimerRef.current);
					persistTimerRef.current = undefined;
				}
				const inflight = persistInflightRef.current;
				if (inflight) {
					await inflight;
				}
			}
			await deleteThreadFromStore(threadId);
			await refreshThreads();
			if (activeThreadIdRef.current === threadId) {
				setMessages([]);
				setQueuedMessages([]);
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

	// Sync controlled `activeThreadId` after mount. The mount effect seeds
	// the initial value; this effect handles parent-driven changes
	// afterwards by switching threads. Gated on `isThreadHistoryReady` so it
	// runs only once the mount load has settled.
	useEffect(() => {
		if (!enableThreadHistory) {
			return;
		}
		if (!isThreadHistoryReady) {
			return;
		}
		if (controlledThreadId === undefined) {
			return;
		}
		if (controlledThreadId === activeThreadIdRef.current) {
			return;
		}
		void switchThread(controlledThreadId);
	}, [
		controlledThreadId,
		enableThreadHistory,
		isThreadHistoryReady,
		switchThread,
	]);

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
