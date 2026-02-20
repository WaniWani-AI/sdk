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
import { cn } from "../lib/utils";
import { Button } from "../ui/button";

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

// ============================================================================
// Attachments Context
// ============================================================================

export interface AttachmentsContext {
	files: (FileUIPart & { id: string })[];
	add: (files: File[] | FileList) => void;
	remove: (id: string) => void;
	clear: () => void;
	openFileDialog: () => void;
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
}

// ============================================================================
// PromptInput
// ============================================================================

export type PromptInputProps = Omit<
	HTMLAttributes<HTMLFormElement>,
	"onSubmit"
> & {
	accept?: string;
	multiple?: boolean;
	globalDrop?: boolean;
	maxFiles?: number;
	maxFileSize?: number;
	onSubmit: (
		message: PromptInputMessage,
		event: FormEvent<HTMLFormElement>,
	) => void | Promise<void>;
};

export const PromptInput = ({
	className,
	accept,
	multiple,
	globalDrop,
	maxFiles,
	maxFileSize,
	onSubmit,
	children,
	...props
}: PromptInputProps) => {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const formRef = useRef<HTMLFormElement | null>(null);
	const [items, setItems] = useState<(FileUIPart & { id: string })[]>([]);
	const filesRef = useRef(items);

	useEffect(() => {
		filesRef.current = items;
	}, [items]);

	const openFileDialog = useCallback(() => {
		inputRef.current?.click();
	}, []);

	const add = useCallback(
		(fileList: File[] | FileList) => {
			const incoming = [...fileList];
			if (incoming.length === 0) return;

			const withinSize = (f: File) =>
				maxFileSize ? f.size <= maxFileSize : true;
			const valid = incoming.filter(withinSize);

			setItems((prev) => {
				const capacity =
					typeof maxFiles === "number"
						? Math.max(0, maxFiles - prev.length)
						: undefined;
				const capped =
					typeof capacity === "number" ? valid.slice(0, capacity) : valid;
				return [
					...prev,
					...capped.map((file) => ({
						filename: file.name,
						id: nanoid(),
						mediaType: file.type,
						type: "file" as const,
						url: URL.createObjectURL(file),
					})),
				];
			});
		},
		[maxFiles, maxFileSize],
	);

	const remove = useCallback((id: string) => {
		setItems((prev) => {
			const found = prev.find((f) => f.id === id);
			if (found?.url) URL.revokeObjectURL(found.url);
			return prev.filter((f) => f.id !== id);
		});
	}, []);

	const clear = useCallback(() => {
		setItems((prev) => {
			for (const f of prev) {
				if (f.url) URL.revokeObjectURL(f.url);
			}
			return [];
		});
	}, []);

	// Cleanup blob URLs on unmount
	useEffect(
		() => () => {
			for (const f of filesRef.current) {
				if (f.url) URL.revokeObjectURL(f.url);
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
		if (!globalDrop) return;
		const onDragOver = (e: DragEvent) => {
			if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
		};
		const onDrop = (e: DragEvent) => {
			if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
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
			const formData = new FormData(form);
			const text = (formData.get("message") as string) || "";

			form.reset();

			const convertedFiles: FileUIPart[] = await Promise.all(
				items.map(async ({ id: _id, ...item }) => {
					if (item.url?.startsWith("blob:")) {
						const dataUrl = await convertBlobUrlToDataUrl(item.url);
						return { ...item, url: dataUrl ?? item.url };
					}
					return item;
				}),
			);

			try {
				const result = onSubmit({ files: convertedFiles, text }, event);
				if (result instanceof Promise) {
					await result;
				}
				clear();
			} catch {
				// Don't clear on error
			}
		},
		[items, onSubmit, clear],
	);

	const attachmentsCtx = useMemo<AttachmentsContext>(
		() => ({
			add,
			clear,
			files: items,
			openFileDialog,
			remove,
		}),
		[items, add, remove, clear, openFileDialog],
	);

	return (
		<LocalAttachmentsContext.Provider value={attachmentsCtx}>
			<input
				accept={accept}
				aria-label="Upload files"
				className="ww:hidden"
				multiple={multiple}
				onChange={handleChange}
				ref={inputRef}
				title="Upload files"
				type="file"
			/>
			<form
				className={cn(
					"ww:flex ww:w-full ww:flex-col ww:rounded-lg ww:border ww:border-border ww:bg-background",
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
	placeholder = "What would you like to know?",
	...props
}: PromptInputTextareaProps) => {
	const attachments = usePromptInputAttachments();
	const [isComposing, setIsComposing] = useState(false);

	const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
		(e) => {
			onKeyDown?.(e);
			if (e.defaultPrevented) return;

			if (e.key === "Enter") {
				if (isComposing || e.nativeEvent.isComposing) return;
				if (e.shiftKey) return;
				e.preventDefault();

				const { form } = e.currentTarget;
				const submitButton = form?.querySelector(
					'button[type="submit"]',
				) as HTMLButtonElement | null;
				if (submitButton?.disabled) return;
				form?.requestSubmit();
			}

			if (
				e.key === "Backspace" &&
				e.currentTarget.value === "" &&
				attachments.files.length > 0
			) {
				e.preventDefault();
				const lastAttachment = attachments.files.at(-1);
				if (lastAttachment) attachments.remove(lastAttachment.id);
			}
		},
		[onKeyDown, isComposing, attachments],
	);

	const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
		(event) => {
			const items = event.clipboardData?.items;
			if (!items) return;

			const files: File[] = [];
			for (const item of items) {
				if (item.kind === "file") {
					const file = item.getAsFile();
					if (file) files.push(file);
				}
			}
			if (files.length > 0) {
				event.preventDefault();
				attachments.add(files);
			}
		},
		[attachments],
	);

	return (
		<textarea
			className={cn(
				"ww:field-sizing-content ww:max-h-48 ww:min-h-16 ww:w-full ww:resize-none ww:border-0 ww:bg-transparent ww:px-3 ww:py-3 ww:text-sm ww:outline-none ww:placeholder:text-muted-foreground",
				className,
			)}
			name="message"
			onCompositionEnd={() => setIsComposing(false)}
			onCompositionStart={() => setIsComposing(true)}
			onKeyDown={handleKeyDown}
			onPaste={handlePaste}
			placeholder={placeholder}
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
			aria-label={isGenerating ? "Stop" : "Submit"}
			className={cn(
				"ww:bg-foreground ww:text-background ww:hover:bg-foreground",
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
				aria-label="Remove all attachments"
				{...props}
			>
				<span className="ww:flex ww:size-5 ww:items-center ww:justify-center ww:rounded-full ww:bg-primary ww:text-[10px] ww:font-medium ww:text-primary-foreground ww:transition-opacity ww:group-hover:opacity-0">
					{attachments.files.length}
				</span>
				<XIcon className="ww:absolute ww:size-4 ww:opacity-0 ww:transition-opacity ww:group-hover:opacity-100" />
			</Button>
		);
	}

	return (
		<Button
			className={cn(className)}
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
