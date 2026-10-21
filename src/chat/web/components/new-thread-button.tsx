"use client";

import { useTranslation } from "../i18n";

function PlusIcon({ label }: { label: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label={label}
		>
			<title>{label}</title>
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</svg>
	);
}

export function NewThreadButton({ onClick }: { onClick: () => void }) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			onClick={onClick}
			title={t.threadMenu.newChat}
			aria-label={t.threadMenu.newChat}
			className="ww:p-1.5 ww:rounded-md ww:text-muted-foreground hover:ww:text-foreground hover:ww:bg-foreground/5 ww:transition-colors ww:cursor-pointer"
		>
			<PlusIcon label={t.threadMenu.newChat} />
		</button>
	);
}
