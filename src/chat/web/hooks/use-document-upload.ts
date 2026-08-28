"use client";

import { useCallback, useEffect, useState } from "react";
import type { AttachedDocument } from "../../../documents/types";
import type { DocumentUploadConfig } from "../@types";
import type {
	AttachmentError,
	AttachmentUploader,
} from "../ai-elements/prompt-input";
import { discardDocument, uploadDocument } from "../lib/document-upload";

const ERROR_VISIBLE_MS = 6000;

export interface DocumentUploadInput {
	api: string;
	headers?: Record<string, string>;
	sessionId?: string;
	/** What the platform says about this project. Absent on a bring-your-own-backend embed. */
	documentUpload?: DocumentUploadConfig;
	/** The switch for an embed the platform never sees. */
	allowAttachments?: boolean;
}

export interface DocumentUploadHandles {
	enabled: boolean;
	accept?: string;
	maxFileSize?: number;
	maxPdfPages?: number;
	maxFiles?: number;
	upload?: AttachmentUploader;
	onDiscard?: (document: AttachedDocument) => void;
	error: AttachmentError | null;
	reportError: (error: AttachmentError) => void;
}

export function useDocumentUpload(
	input: DocumentUploadInput,
): DocumentUploadHandles {
	const { api, headers, sessionId, documentUpload, allowAttachments } = input;
	const [error, setError] = useState<AttachmentError | null>(null);

	const upload: AttachmentUploader = useCallback(
		(file, signal, onProgress) =>
			uploadDocument({
				file,
				api,
				headers: headers ?? {},
				sessionId,
				signal,
				onProgress,
			}),
		[api, headers, sessionId],
	);

	const onDiscard = useCallback(
		(document: AttachedDocument) => {
			void discardDocument({
				documentId: document.documentId,
				api,
				headers: headers ?? {},
			});
		},
		[api, headers],
	);

	useEffect(() => {
		if (!error) {
			return;
		}
		const timer = setTimeout(() => setError(null), ERROR_VISIBLE_MS);
		return () => clearTimeout(timer);
	}, [error]);

	const uploading = documentUpload?.enabled ?? false;

	return {
		// The platform's answer wins wherever it speaks.
		enabled: documentUpload
			? documentUpload.enabled
			: Boolean(allowAttachments),
		accept: documentUpload?.accept.join(","),
		maxFileSize: documentUpload?.maxBytes,
		maxPdfPages: documentUpload?.maxPdfPages,
		maxFiles: documentUpload?.maxFiles,
		upload: uploading ? upload : undefined,
		onDiscard: uploading ? onDiscard : undefined,
		error,
		reportError: setError,
	};
}
