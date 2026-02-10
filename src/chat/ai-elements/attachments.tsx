"use client";

import type { FileUIPart } from "ai";
import { FileIcon } from "lucide-react";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

// ============================================================================
// Attachments (inline list for chat bubbles)
// ============================================================================

export type AttachmentsProps = HTMLAttributes<HTMLDivElement> & {
	files: FileUIPart[];
};

export const Attachments = ({ files, className, ...props }: AttachmentsProps) => {
	if (files.length === 0) return null;

	return (
		<div className={cn("flex flex-wrap gap-1.5", className)} {...props}>
			{files.map((file, i) => (
				<AttachmentItem key={i} file={file} />
			))}
		</div>
	);
};

// ============================================================================
// AttachmentItem
// ============================================================================

function AttachmentItem({ file }: { file: FileUIPart }) {
	const isImage = file.mediaType?.startsWith("image/");

	if (isImage && file.url) {
		return (
			<img
				src={file.url}
				alt={file.filename ?? "attachment"}
				className="h-16 max-w-32 rounded object-cover"
			/>
		);
	}

	return (
		<span className="inline-flex items-center gap-1.5 rounded bg-background/20 px-2 py-1 text-xs">
			<FileIcon className="size-3 shrink-0" />
			<span className="max-w-24 truncate">
				{file.filename ?? "file"}
			</span>
		</span>
	);
}
