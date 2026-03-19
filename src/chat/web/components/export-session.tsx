"use client";

import type { UIMessage } from "@ai-sdk/react";

interface SessionReplay {
	name: string;
	messages: UIMessage[];
	mode: "regenerate";
}

export function ExportSessionButton({ messages }: { messages: UIMessage[] }) {
	const handleExport = () => {
		const session: SessionReplay = {
			name: `session-${new Date().toISOString().slice(0, 19)}`,
			messages,
			mode: "regenerate",
		};
		const json = JSON.stringify(session, null, 2);

		navigator.clipboard.writeText(json).then(
			() => {
				console.log("[waniwani:debug] Session copied to clipboard");
			},
			() => {
				const blob = new Blob([json], { type: "application/json" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = `${session.name}.json`;
				a.click();
				URL.revokeObjectURL(url);
			},
		);
	};

	if (messages.length === 0) {
		return null;
	}

	return (
		<button
			type="button"
			onClick={handleExport}
			title="Export session as eval test fixture"
			className="ww:ml-auto ww:text-xs ww:opacity-60 hover:ww:opacity-100 ww:cursor-pointer ww:transition-opacity ww:px-2 ww:py-1 ww:rounded ww:border ww:border-current/20"
		>
			Export
		</button>
	);
}
