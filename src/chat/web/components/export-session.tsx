"use client";

import type { UIMessage } from "@ai-sdk/react";
import { useState } from "react";

interface ExportSessionButtonProps {
	messages: UIMessage[];
	evalEnabled: boolean;
	api?: string;
}

export function ExportSessionButton({
	messages,
	evalEnabled,
	api = "/api/waniwani",
}: ExportSessionButtonProps) {
	const [saving, setSaving] = useState(false);
	const [feedback, setFeedback] = useState<"saved" | "error" | null>(null);

	const handleExport = async () => {
		const session = {
			name: `session-${new Date().toISOString().slice(0, 19)}`,
			type: "functional" as const,
			messages,
			mode: "manual" as const,
		};

		setSaving(true);
		setFeedback(null);

		try {
			const res = await fetch(`${api}/scenarios`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(session),
			});
			if (!res.ok) {
				throw new Error(`${res.status}`);
			}
			setFeedback("saved");
		} catch {
			setFeedback("error");
		} finally {
			setSaving(false);
			setTimeout(() => setFeedback(null), 2000);
		}
	};

	if (!evalEnabled || messages.length === 0) {
		return null;
	}

	const label = saving
		? "saving..."
		: feedback === "saved"
			? "saved"
			: feedback === "error"
				? "error"
				: "export";

	return (
		<button
			type="button"
			onClick={handleExport}
			disabled={saving}
			title="Save scenario to WaniWani"
			className="ww:ml-auto ww:text-[10px] ww:font-mono ww:uppercase ww:tracking-wider ww:text-muted-foreground hover:ww:text-foreground ww:cursor-pointer ww:transition-colors ww:disabled:opacity-40"
		>
			{label}
		</button>
	);
}
