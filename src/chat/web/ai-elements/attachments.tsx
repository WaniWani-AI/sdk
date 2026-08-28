"use client";

import type { FileUIPart } from "ai";
import { FileIcon, FileTextIcon, ImageIcon } from "lucide-react";
import { type HTMLAttributes, type ReactNode, useState } from "react";
import type { AttachedDocument } from "../../../documents/types";
import { type Messages, useTranslation } from "../i18n";
import { documentPreviewUrl } from "../lib/document-previews";
import { cn } from "../lib/utils";

export type AttachmentsProps = HTMLAttributes<HTMLDivElement> & {
	files: FileUIPart[];
};

export const Attachments = ({
	files,
	className,
	...props
}: AttachmentsProps) => {
	if (files.length === 0) {
		return null;
	}

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

function AttachmentItem({ file }: { file: FileUIPart }) {
	const { t } = useTranslation();
	const isImage = file.mediaType?.startsWith("image/");

	if (isImage && file.url) {
		return (
			<img
				src={file.url}
				alt={file.filename ?? t.attachments.attachmentFallback}
				className="ww:h-16 ww:max-w-32 ww:rounded ww:object-cover"
			/>
		);
	}

	return (
		<span className="ww:inline-flex ww:items-center ww:gap-1.5 ww:rounded ww:bg-background/20 ww:px-2 ww:py-1 ww:text-xs">
			<FileIcon className="ww:size-3 ww:shrink-0" />
			<span className="ww:max-w-24 ww:truncate">
				{file.filename ?? t.attachments.fileFallback}
			</span>
		</span>
	);
}

export function documentKindLabel(mediaType: string, t: Messages): string {
	if (mediaType.startsWith("image/")) {
		return t.attachments.kindImage;
	}
	return mediaType === "application/pdf"
		? t.attachments.kindPdf
		: t.attachments.kindFile;
}

function DocumentGlyph({ mediaType }: { mediaType: string }) {
	if (mediaType.startsWith("image/")) {
		return <ImageIcon className="ww:size-5 ww:text-muted-foreground" />;
	}
	if (mediaType === "application/pdf") {
		return <FileTextIcon className="ww:size-5 ww:text-muted-foreground" />;
	}
	return <FileIcon className="ww:size-5 ww:text-muted-foreground" />;
}

export type DocumentTileProps = {
	filename: string;
	mediaType: string;
	/** Shown in the leading square, cropped to it. */
	previewUrl?: string;
	subtitle?: string;
	tone?: "default" | "error";
	children?: ReactNode;
	className?: string;
};

export function DocumentTile({
	filename,
	mediaType,
	previewUrl,
	subtitle,
	tone = "default",
	children,
	className,
}: DocumentTileProps) {
	const { t } = useTranslation();
	const kind = documentKindLabel(mediaType, t);

	return (
		<li
			aria-label={`${filename}, ${kind}`}
			className={cn(
				"ww:relative ww:flex ww:w-60 ww:max-w-full ww:cursor-default ww:items-center ww:gap-2.5 ww:overflow-hidden ww:rounded-xl ww:border ww:bg-background ww:p-2.5",
				tone === "error" ? "ww:border-destructive/50" : "ww:border-border",
				className,
			)}
		>
			<span className="ww:flex ww:size-10 ww:shrink-0 ww:items-center ww:justify-center ww:overflow-hidden ww:rounded-xl ww:bg-muted">
				{previewUrl ? (
					<img
						alt=""
						className="ww:size-full ww:object-cover ww:object-center"
						src={previewUrl}
					/>
				) : (
					<DocumentGlyph mediaType={mediaType} />
				)}
			</span>

			<span className="ww:flex ww:min-w-0 ww:flex-col">
				<span
					className="ww:truncate ww:font-medium ww:text-sm"
					title={filename}
				>
					{filename}
				</span>
				<span
					className={cn(
						"ww:truncate ww:text-xs",
						tone === "error"
							? "ww:text-destructive"
							: "ww:text-muted-foreground",
					)}
				>
					{subtitle ?? kind}
				</span>
			</span>

			{children}
		</li>
	);
}

/** Message metadata is unknown at the type level, so a turn's attachments are read defensively. */
export function readAttachedDocuments(metadata: unknown): AttachedDocument[] {
	if (typeof metadata !== "object" || metadata === null) {
		return [];
	}
	const declared = (metadata as { documents?: unknown }).documents;
	if (!Array.isArray(declared)) {
		return [];
	}
	return declared.filter(
		(entry): entry is AttachedDocument =>
			typeof entry === "object" &&
			entry !== null &&
			typeof (entry as AttachedDocument).documentId === "string" &&
			typeof (entry as AttachedDocument).filename === "string" &&
			typeof (entry as AttachedDocument).mediaType === "string",
	);
}

export type AttachedDocumentsProps = HTMLAttributes<HTMLUListElement> & {
	documents: AttachedDocument[];
};

export const AttachedDocuments = ({
	documents,
	className,
	...props
}: AttachedDocumentsProps) => {
	if (documents.length === 0) {
		return null;
	}

	return (
		<ul
			className={cn(
				"ww:flex ww:list-none ww:flex-wrap ww:items-end ww:justify-end ww:gap-2 ww:p-0",
				className,
			)}
			{...props}
		>
			{documents.map((document, index) => (
				<AttachedDocumentTile
					document={document}
					key={`${document.documentId}-${index}`}
				/>
			))}
		</ul>
	);
};

function AttachedDocumentTile({ document }: { document: AttachedDocument }) {
	const { t } = useTranslation();
	const [previewBroke, setPreviewBroke] = useState(false);
	const preview = document.mediaType.startsWith("image/")
		? documentPreviewUrl(document.documentId)
		: undefined;

	if (preview && !previewBroke) {
		return (
			<li>
				<img
					alt={`${document.filename}, ${documentKindLabel(document.mediaType, t)}`}
					className="ww:max-h-80 ww:max-w-72 ww:rounded-xl ww:border ww:border-border ww:object-contain"
					onError={() => setPreviewBroke(true)}
					src={preview}
					title={document.filename}
				/>
			</li>
		);
	}

	return (
		<DocumentTile filename={document.filename} mediaType={document.mediaType} />
	);
}
