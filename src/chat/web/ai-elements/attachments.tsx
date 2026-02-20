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

export const Attachments = ({
	files,
	className,
	...props
}: AttachmentsProps) => {
	if (files.length === 0) return null;

	return (
		<div
			className={cn("ww:flex ww:flex-wrap ww:gap-1.5", className)}
			{...props}
		>
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
				className="ww:h-16 ww:max-w-32 ww:rounded ww:object-cover"
			/>
		);
	}

	return (
		<span className="ww:inline-flex ww:items-center ww:gap-1.5 ww:rounded ww:bg-background/20 ww:px-2 ww:py-1 ww:text-xs">
			<FileIcon className="ww:size-3 ww:shrink-0" />
			<span className="ww:max-w-24 ww:truncate">{file.filename ?? "file"}</span>
		</span>
	);
}
