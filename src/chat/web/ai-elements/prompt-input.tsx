"use client";

import type { ChatStatus, FileUIPart } from "ai";
import {
	ArrowUpIcon,
	LoaderIcon,
	PaperclipIcon,
	SquareIcon,
	XIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import type {
	ChangeEvent,
	ClipboardEventHandler,
	ComponentProps,
	FormEvent,
	FormEventHandler,
	HTMLAttributes,
	KeyboardEventHandler,
} from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { AttachedDocument } from "../../../documents/types";
import { useTranslation } from "../i18n";
import { rememberDocumentPreview } from "../lib/document-previews";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { DocumentTile } from "./attachments";

// ============================================================================
// Helpers
// ============================================================================

const convertBlobUrlToDataUrl = async (url: string): Promise<string | null> => {
	try {
		const response = await fetch(url);
		const blob = await response.blob();
		return new Promise((resolve) => {
			const reader = new FileReader();
			reader.onloadend = () => resolve(reader.result as string);
			reader.onerror = () => resolve(null);
			reader.readAsDataURL(blob);
		});
	} catch {
		return null;
	}
};

/** Mirrors what the OS picker does with the `accept` attribute, for the drop and paste paths it never sees. */
const matchesAccept = (file: File, accept: string | undefined): boolean => {
	if (!accept) {
		return true;
	}
	const patterns = accept
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	if (patterns.length === 0) {
		return true;
	}

	const type = file.type.toLowerCase();
	const name = file.name.toLowerCase();

	return patterns.some((pattern) => {
		if (pattern.startsWith(".")) {
			return name.endsWith(pattern);
		}
		if (pattern.endsWith("/*")) {
			return type.startsWith(pattern.slice(0, -1));
		}
		return type === pattern;
	});
};

// ============================================================================
// Attachments Context
// ============================================================================

export type AttachmentErrorCode =
	| "max_files"
	| "max_file_size"
	| "accept"
	| "upload_disabled"
	| "upload_failed";

export interface AttachmentError {
	code: AttachmentErrorCode;
	message: string;
}

export type AttachmentStatus = "ready" | "uploading" | "failed";

export type AttachmentItem = FileUIPart & {
	id: string;
	status: AttachmentStatus;
	/** 0 to 1 while uploading. */
	progress: number;
	error?: string;
	/** Set once the platform has the bytes; what the message carries instead of the file. */
	documentId?: string;
};

export type AttachmentUploader = (
	file: File,
	signal: AbortSignal,
	onProgress: (fraction: number) => void,
) => Promise<AttachedDocument>;

export interface AttachmentsContext {
	files: AttachmentItem[];
	add: (files: File[] | FileList) => void;
	remove: (id: string) => void;
	retry: (id: string) => void;
	clear: () => void;
	openFileDialog: () => void;
	/** The picker cannot filter by size, so the composer states the limit instead. */
	maxFileSize?: number;
	/** Only the vendor can count pages, so the composer states this rather than enforcing it. */
	maxPdfPages?: number;
}

const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null);

export const usePromptInputAttachments = () => {
	const context = useContext(LocalAttachmentsContext);
	if (!context) {
		throw new Error(
			"usePromptInputAttachments must be used within a PromptInput",
		);
	}
	return context;
};

// ============================================================================
// PromptInput Message Type
// ============================================================================

export interface PromptInputMessage {
	text: string;
	files: FileUIPart[];
	/** Documents already uploaded out of band; the message carries only their ids. */
	documents?: AttachedDocument[];
}

// ============================================================================
// PromptInput
// ============================================================================

export type PromptInputProps = Omit<
	HTMLAttributes<HTMLFormElement>,
	"onSubmit" | "onError"
> & {
	accept?: string;
	multiple?: boolean;
	globalDrop?: boolean;
	maxFiles?: number;
	maxFileSize?: number;
	maxPdfPages?: number;
	/** Gates the picker, the drop target and the paste handler together. */
	attachmentsEnabled?: boolean;
	/** When set, an attachment uploads as soon as it is picked and the message carries its id. */
	upload?: AttachmentUploader;
	/** Called when a visitor takes an uploaded attachment back, so the copy already stored can go. */
	onDiscard?: (document: AttachedDocument) => void;
	onError?: (error: AttachmentError) => void;
	onSubmit: (
		message: PromptInputMessage,
		event: FormEvent<HTMLFormElement>,
	) => void | Promise<void>;
};

interface PendingUpload {
	file: File;
	controller: AbortController;
	/** Resolves to the upload's result, which submit reads instead of React state. */
	done: Promise<AttachedDocument | null>;
}

export const PromptInput = ({
	className,
	accept,
	multiple,
	globalDrop,
	maxFiles,
	maxFileSize,
	maxPdfPages,
	attachmentsEnabled = true,
	upload,
	onDiscard,
	onError,
	onSubmit,
	children,
	...props
}: PromptInputProps) => {
	const { t } = useTranslation();
	const inputRef = useRef<HTMLInputElement | null>(null);
	const formRef = useRef<HTMLFormElement | null>(null);
	const [items, setItems] = useState<AttachmentItem[]>([]);
	const filesRef = useRef(items);
	const pendingRef = useRef(new Map<string, PendingUpload>());

	const uploadRef = useRef(upload);
	const onErrorRef = useRef(onError);
	const onDiscardRef = useRef(onDiscard);
	useEffect(() => {
		uploadRef.current = upload;
		onErrorRef.current = onError;
		onDiscardRef.current = onDiscard;
	}, [upload, onError, onDiscard]);

	// `filesRef` leads the state: `add` and `remove` have to see their own effect
	// immediately, and a passive effect does not run until the next flush.
	const commit = useCallback((next: AttachmentItem[]) => {
		filesRef.current = next;
		setItems(next);
	}, []);

	const openFileDialog = useCallback(() => {
		inputRef.current?.click();
	}, []);

	const patch = useCallback(
		(id: string, change: Partial<AttachmentItem>) => {
			commit(
				filesRef.current.map((item) =>
					item.id === id ? { ...item, ...change } : item,
				),
			);
		},
		[commit],
	);

	const startUpload = useCallback(
		(id: string, file: File) => {
			const uploader = uploadRef.current;
			if (!uploader) {
				return;
			}

			const controller = new AbortController();
			const done = uploader(file, controller.signal, (fraction) => {
				patch(id, { progress: fraction });
			})
				.then((document) => {
					patch(id, {
						status: "ready",
						progress: 1,
						documentId: document.documentId,
						error: undefined,
					});
					return document;
				})
				.catch((error: unknown) => {
					if (controller.signal.aborted) {
						return null;
					}
					const message =
						error instanceof Error ? error.message : t.promptInput.uploadFailed;
					patch(id, { status: "failed", error: message });
					onErrorRef.current?.({ code: "upload_failed", message });
					return null;
				});

			pendingRef.current.set(id, { file, controller, done });
		},
		[patch, t],
	);

	const add = useCallback(
		(fileList: File[] | FileList) => {
			const incoming = [...fileList];
			if (!attachmentsEnabled || incoming.length === 0) {
				return;
			}

			const report = (code: AttachmentErrorCode, message: string) =>
				onErrorRef.current?.({ code, message });

			const accepted: File[] = [];
			for (const file of incoming) {
				if (!matchesAccept(file, accept)) {
					report(
						"accept",
						t.promptInput.errorAccept.replace("{name}", file.name),
					);
					continue;
				}
				if (maxFileSize && file.size > maxFileSize) {
					report(
						"max_file_size",
						t.promptInput.errorTooLarge
							.replace("{name}", file.name)
							.replace("{limit}", formatBytes(maxFileSize)),
					);
					continue;
				}
				accepted.push(file);
			}

			if (accepted.length === 0) {
				return;
			}

			const capacity =
				typeof maxFiles === "number"
					? Math.max(0, maxFiles - filesRef.current.length)
					: undefined;
			const admitted =
				typeof capacity === "number" ? accepted.slice(0, capacity) : accepted;

			if (admitted.length < accepted.length) {
				report(
					"max_files",
					t.promptInput.errorTooMany.replace("{limit}", String(maxFiles)),
				);
			}
			if (admitted.length === 0) {
				return;
			}

			const uploading = Boolean(uploadRef.current);
			const created = admitted.map((file) => ({
				file,
				item: {
					filename: file.name,
					id: nanoid(),
					mediaType: file.type,
					type: "file" as const,
					url: URL.createObjectURL(file),
					status: uploading ? ("uploading" as const) : ("ready" as const),
					progress: 0,
				},
			}));

			commit([...filesRef.current, ...created.map((entry) => entry.item)]);

			for (const entry of created) {
				startUpload(entry.item.id, entry.file);
			}
		},
		[maxFiles, maxFileSize, accept, attachmentsEnabled, startUpload, commit, t],
	);

	const retry = useCallback(
		(id: string) => {
			const pending = pendingRef.current.get(id);
			if (!pending) {
				return;
			}
			patch(id, { status: "uploading", progress: 0, error: undefined });
			startUpload(id, pending.file);
		},
		[patch, startUpload],
	);

	const forget = useCallback((item: AttachmentItem, takenBack: boolean) => {
		pendingRef.current.get(item.id)?.controller.abort();
		pendingRef.current.delete(item.id);
		if (item.url) {
			const keepAsPreview =
				!takenBack &&
				Boolean(item.documentId) &&
				Boolean(item.mediaType?.startsWith("image/"));
			if (keepAsPreview && item.documentId) {
				rememberDocumentPreview(item.documentId, item.url);
			} else {
				URL.revokeObjectURL(item.url);
			}
		}
		if (takenBack && item.documentId) {
			onDiscardRef.current?.({
				documentId: item.documentId,
				filename: item.filename ?? "",
				mediaType: item.mediaType ?? "",
			});
		}
	}, []);

	const remove = useCallback(
		(id: string) => {
			const found = filesRef.current.find((f) => f.id === id);
			if (found) {
				forget(found, true);
			}
			commit(filesRef.current.filter((f) => f.id !== id));
		},
		[forget, commit],
	);

	const clear = useCallback(() => {
		for (const f of filesRef.current) {
			forget(f, true);
		}
		commit([]);
	}, [forget, commit]);

	// Turning the module off mid-session hides the chips but would leave their
	// items behind, and one failed hidden upload makes every later submit refuse.
	const wasEnabledRef = useRef(attachmentsEnabled);
	useEffect(() => {
		const wasEnabled = wasEnabledRef.current;
		wasEnabledRef.current = attachmentsEnabled;
		if (wasEnabled && !attachmentsEnabled) {
			clear();
		}
	}, [attachmentsEnabled, clear]);

	/** Emptying the composer after a send keeps what was sent. */
	const settle = useCallback(() => {
		for (const f of filesRef.current) {
			forget(f, false);
		}
		commit([]);
	}, [forget, commit]);

	// Cleanup blob URLs on unmount
	useEffect(
		() => () => {
			for (const f of filesRef.current) {
				pendingRef.current.get(f.id)?.controller.abort();
				if (f.url) {
					URL.revokeObjectURL(f.url);
				}
			}
		},
		[],
	);

	const handleChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			if (event.currentTarget.files) {
				add(event.currentTarget.files);
			}
			event.currentTarget.value = "";
		},
		[add],
	);

	// Global drop support
	useEffect(() => {
		if (!globalDrop) {
			return;
		}
		const onDragOver = (e: DragEvent) => {
			if (e.dataTransfer?.types?.includes("Files")) {
				e.preventDefault();
			}
		};
		const onDrop = (e: DragEvent) => {
			if (e.dataTransfer?.types?.includes("Files")) {
				e.preventDefault();
			}
			if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
				add(e.dataTransfer.files);
			}
		};
		document.addEventListener("dragover", onDragOver);
		document.addEventListener("drop", onDrop);
		return () => {
			document.removeEventListener("dragover", onDragOver);
			document.removeEventListener("drop", onDrop);
		};
	}, [add, globalDrop]);

	const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
		async (event) => {
			event.preventDefault();
			const form = event.currentTarget;
			const text = (new FormData(form).get("message") as string) || "";

			// An upload started while the visitor was still typing may still be in
			// flight; the message cannot carry an id that does not exist yet.
			const uploaded = new Map<string, AttachedDocument | null>();
			while (uploaded.size < pendingRef.current.size) {
				await Promise.all(
					[...pendingRef.current.entries()]
						.filter(([id]) => !uploaded.has(id))
						.map(async ([id, pending]) => {
							uploaded.set(id, await pending.done);
						}),
				);
			}

			for (const id of uploaded.keys()) {
				if (!pendingRef.current.has(id)) {
					uploaded.delete(id);
				}
			}

			if ([...uploaded.values()].some((document) => document === null)) {
				onErrorRef.current?.({
					code: "upload_failed",
					message: t.promptInput.uploadFailed,
				});
				return;
			}

			const documents = [...uploaded.values()].filter(
				(document): document is AttachedDocument => document !== null,
			);
			const inline = uploadRef.current ? [] : filesRef.current;

			const convertedFiles: FileUIPart[] = await Promise.all(
				inline.map(
					async ({ id: _id, status: _s, progress: _p, error: _e, ...item }) => {
						if (item.url?.startsWith("blob:")) {
							const dataUrl = await convertBlobUrlToDataUrl(item.url);
							return { ...item, url: dataUrl ?? item.url };
						}
						return item;
					},
				),
			);

			try {
				const result = onSubmit(
					{ documents, files: convertedFiles, text },
					event,
				);
				if (result instanceof Promise) {
					await result;
				}
				form.reset();
				settle();
			} catch {
				// Don't clear on error
			}
		},
		[onSubmit, settle, t],
	);

	const attachmentsCtx = useMemo<AttachmentsContext>(
		() => ({
			add,
			clear,
			files: items,
			openFileDialog,
			remove,
			retry,
			maxFileSize,
			maxPdfPages,
		}),
		[
			items,
			add,
			remove,
			retry,
			clear,
			openFileDialog,
			maxFileSize,
			maxPdfPages,
		],
	);

	return (
		<LocalAttachmentsContext.Provider value={attachmentsCtx}>
			<input
				accept={accept}
				aria-label={t.promptInput.uploadFiles}
				className="ww:hidden"
				multiple={multiple}
				onChange={handleChange}
				ref={inputRef}
				title={t.promptInput.uploadFiles}
				type="file"
			/>
			<form
				className={cn(
					"ww:relative ww:flex ww:w-full ww:flex-col ww:rounded-lg ww:border ww:border-border ww:bg-background",
					className,
				)}
				onSubmit={handleSubmit}
				ref={formRef}
				{...props}
			>
				{children}
			</form>
		</LocalAttachmentsContext.Provider>
	);
};

const BYTES_PER_MB = 1024 * 1024;

function formatBytes(bytes: number): string {
	if (bytes >= BYTES_PER_MB) {
		return `${Math.round(bytes / BYTES_PER_MB)} MB`;
	}
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ============================================================================
// Layout Components
// ============================================================================

export type PromptInputHeaderProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputHeader = ({
	className,
	...props
}: PromptInputHeaderProps) => (
	<div
		className={cn("ww:flex ww:flex-wrap ww:gap-1 ww:px-3 ww:pt-3", className)}
		{...props}
	/>
);

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({
	className,
	...props
}: PromptInputBodyProps) => (
	<div className={cn("ww:contents", className)} {...props} />
);

export type PromptInputFooterProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputFooter = ({
	className,
	...props
}: PromptInputFooterProps) => (
	<div
		className={cn(
			"ww:flex ww:items-center ww:justify-between ww:gap-1 ww:px-3 ww:pb-3",
			className,
		)}
		{...props}
	/>
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
	className,
	...props
}: PromptInputToolsProps) => (
	<div
		className={cn("ww:flex ww:min-w-0 ww:items-center ww:gap-1", className)}
		{...props}
	/>
);

// ============================================================================
// Textarea
// ============================================================================

export type PromptInputTextareaProps = ComponentProps<"textarea">;

export const PromptInputTextarea = ({
	onChange,
	onKeyDown,
	className,
	placeholder,
	...props
}: PromptInputTextareaProps) => {
	const { t } = useTranslation();
	const attachments = usePromptInputAttachments();
	const [isComposing, setIsComposing] = useState(false);
	const resolvedPlaceholder = placeholder ?? t.promptInput.placeholder;

	const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
		(e) => {
			onKeyDown?.(e);
			if (e.defaultPrevented) {
				return;
			}

			if (e.key === "Enter") {
				if (isComposing || e.nativeEvent.isComposing) {
					return;
				}
				if (e.shiftKey) {
					return;
				}
				e.preventDefault();

				const { form } = e.currentTarget;
				const submitButton = form?.querySelector(
					'button[type="submit"]',
				) as HTMLButtonElement | null;
				if (submitButton?.disabled) {
					return;
				}
				form?.requestSubmit();
			}

			if (
				e.key === "Backspace" &&
				e.currentTarget.value === "" &&
				attachments.files.length > 0
			) {
				e.preventDefault();
				const lastAttachment = attachments.files.at(-1);
				if (lastAttachment) {
					attachments.remove(lastAttachment.id);
				}
			}
		},
		[onKeyDown, isComposing, attachments],
	);

	const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
		(event) => {
			const items = event.clipboardData?.items;
			if (!items) {
				return;
			}

			const files: File[] = [];
			for (const item of items) {
				if (item.kind === "file") {
					const file = item.getAsFile();
					if (file) {
						files.push(file);
					}
				}
			}
			if (files.length > 0) {
				event.preventDefault();
				attachments.add(files);
			}
		},
		[attachments],
	);

	// `ww:text-base` (16px) on mobile is load-bearing: iOS Safari auto-zooms
	// any focused input/textarea under 16px, breaking the chat layout. The
	// `ww:sm:text-sm` override restores the smaller text on tablet+ where the
	// zoom rule doesn't apply.
	return (
		<textarea
			className={cn(
				"ww:field-sizing-content ww:max-h-48 ww:min-h-0 ww:w-full ww:resize-none ww:border-0 ww:bg-transparent ww:px-3 ww:py-2 ww:text-base ww:sm:text-sm ww:outline-none ww:placeholder:text-muted-foreground",
				className,
			)}
			name="message"
			onCompositionEnd={() => setIsComposing(false)}
			onCompositionStart={() => setIsComposing(true)}
			onKeyDown={handleKeyDown}
			onPaste={handlePaste}
			placeholder={resolvedPlaceholder}
			onChange={onChange}
			{...props}
		/>
	);
};

// ============================================================================
// Submit Button
// ============================================================================

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
	status?: ChatStatus;
	onStop?: () => void;
};

export const PromptInputSubmit = ({
	className,
	status,
	onStop,
	onClick,
	children,
	...props
}: PromptInputSubmitProps) => {
	const { t } = useTranslation();
	const isGenerating = status === "submitted" || status === "streaming";

	let Icon = <ArrowUpIcon className="ww:size-4" />;
	if (status === "submitted") {
		Icon = <LoaderIcon className="ww:size-4 ww:animate-spin" />;
	} else if (status === "streaming") {
		Icon = <SquareIcon className="ww:size-4" />;
	}

	const handleClick = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			if (isGenerating && onStop) {
				e.preventDefault();
				onStop();
				return;
			}
			onClick?.(e);
		},
		[isGenerating, onStop, onClick],
	);

	return (
		<Button
			aria-label={isGenerating ? t.promptInput.stop : t.promptInput.submit}
			className={cn(
				"ww:bg-foreground ww:text-background ww:hover:bg-foreground ww:rounded-full",
				className,
			)}
			onClick={handleClick}
			size="icon-sm"
			type={isGenerating && onStop ? "button" : "submit"}
			variant="ghost"
			{...props}
		>
			{children ?? Icon}
		</Button>
	);
};

// ============================================================================
// Attachment Add Button (simple file picker, no Radix dropdown)
// ============================================================================

export type PromptInputAddAttachmentsProps = ComponentProps<typeof Button>;

export const PromptInputAddAttachments = ({
	className,
	children,
	...props
}: PromptInputAddAttachmentsProps) => {
	const { t } = useTranslation();
	const attachments = usePromptInputAttachments();
	const hasFiles = attachments.files.length > 0;

	if (hasFiles) {
		return (
			<Button
				className={cn("ww:group ww:relative", className)}
				onClick={() => attachments.clear()}
				size="icon-sm"
				type="button"
				variant="ghost"
				aria-label={t.promptInput.removeAttachments}
				{...props}
			>
				<span className="ww:flex ww:size-5 ww:items-center ww:justify-center ww:rounded-full ww:bg-primary ww:text-[10px] ww:font-medium ww:text-primary-foreground ww:transition-opacity ww:group-hover:opacity-0">
					{attachments.files.length}
				</span>
				<XIcon className="ww:absolute ww:size-4 ww:opacity-0 ww:transition-opacity ww:group-hover:opacity-100" />
			</Button>
		);
	}

	const label = attachments.maxFileSize
		? (attachments.maxPdfPages
				? t.promptInput.uploadFilesUpToWithPages.replace(
						"{pages}",
						String(attachments.maxPdfPages),
					)
				: t.promptInput.uploadFilesUpTo
			).replace("{limit}", formatBytes(attachments.maxFileSize))
		: t.promptInput.uploadFiles;

	return (
		<Button
			aria-label={label}
			className={cn(className)}
			title={label}
			onClick={() => attachments.openFileDialog()}
			size="icon-sm"
			type="button"
			variant="ghost"
			{...props}
		>
			{children ?? <PaperclipIcon className="ww:size-4" />}
		</Button>
	);
};

// ============================================================================
// Attachment chips (composer)
// ============================================================================

export type PromptInputAttachmentsProps = HTMLAttributes<HTMLUListElement>;

export const PromptInputAttachments = ({
	className,
	...props
}: PromptInputAttachmentsProps) => {
	const attachments = usePromptInputAttachments();

	if (attachments.files.length === 0) {
		return null;
	}

	return (
		<ul
			className={cn(
				"ww:flex ww:list-none ww:flex-wrap ww:gap-2 ww:p-0",
				className,
			)}
			{...props}
		>
			{attachments.files.map((file) => (
				<PromptInputAttachment key={file.id} file={file} />
			))}
		</ul>
	);
};

function PromptInputAttachment({ file }: { file: AttachmentItem }) {
	const { t } = useTranslation();
	const attachments = usePromptInputAttachments();
	const failed = file.status === "failed";
	const uploading = file.status === "uploading";

	return (
		<DocumentTile
			filename={file.filename ?? t.attachments.fileFallback}
			mediaType={file.mediaType ?? ""}
			previewUrl={file.mediaType?.startsWith("image/") ? file.url : undefined}
			subtitle={
				failed ? file.error : uploading ? t.promptInput.uploading : undefined
			}
			tone={failed ? "error" : "default"}
		>
			{failed ? (
				<button
					aria-label={t.promptInput.retryUpload}
					className="ww:ml-auto ww:shrink-0 ww:text-destructive ww:text-xs ww:underline ww:underline-offset-2"
					onClick={() => attachments.retry(file.id)}
					type="button"
				>
					{t.promptInput.retry}
				</button>
			) : null}

			<button
				aria-label={t.promptInput.removeAttachment}
				className={cn(
					"ww:shrink-0 ww:rounded-full ww:p-1 ww:opacity-60 ww:transition-opacity hover:ww:bg-muted hover:ww:opacity-100",
					failed ? null : "ww:ml-auto",
				)}
				onClick={() => attachments.remove(file.id)}
				type="button"
			>
				<XIcon className="ww:size-3.5" />
			</button>

			{uploading ? (
				<span
					aria-hidden
					className="ww:absolute ww:bottom-0 ww:left-0 ww:h-0.5 ww:bg-primary ww:transition-[width] ww:duration-200"
					style={{ width: `${Math.round(file.progress * 100)}%` }}
				/>
			) : null}
		</DocumentTile>
	);
}

// ============================================================================
// Drop overlay
// ============================================================================

export type PromptInputDropOverlayProps = {
	enabled?: boolean;
};

export const PromptInputDropOverlay = ({
	enabled = true,
}: PromptInputDropOverlayProps) => {
	const { t } = useTranslation();
	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		// `dragenter`/`dragleave` fire per element crossed, so a depth counter is
		// what keeps the overlay from flickering across children.
		let depth = 0;
		const carriesFiles = (event: DragEvent) =>
			Boolean(event.dataTransfer?.types?.includes("Files"));

		const onEnter = (event: DragEvent) => {
			if (!carriesFiles(event)) {
				return;
			}
			depth += 1;
			setDragging(true);
		};
		const onLeave = (event: DragEvent) => {
			if (!carriesFiles(event)) {
				return;
			}
			depth = Math.max(0, depth - 1);
			if (depth === 0) {
				setDragging(false);
			}
		};
		const onDrop = () => {
			depth = 0;
			setDragging(false);
		};

		document.addEventListener("dragenter", onEnter);
		document.addEventListener("dragleave", onLeave);
		document.addEventListener("drop", onDrop);
		return () => {
			document.removeEventListener("dragenter", onEnter);
			document.removeEventListener("dragleave", onLeave);
			document.removeEventListener("drop", onDrop);
		};
	}, [enabled]);

	if (!(enabled && dragging)) {
		return null;
	}

	return (
		<div className="ww:pointer-events-none ww:absolute ww:inset-0 ww:z-50 ww:flex ww:items-center ww:justify-center ww:rounded-2xl ww:border-2 ww:border-primary ww:border-dashed ww:bg-background/85">
			<span className="ww:flex ww:items-center ww:gap-2 ww:text-sm ww:font-medium">
				<PaperclipIcon className="ww:size-4" />
				{t.promptInput.dropToAttach}
			</span>
		</div>
	);
};
