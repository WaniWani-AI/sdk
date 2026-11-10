"use client";

import { SquarePenIcon } from "lucide-react";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { PARTS } from "../parts";
import { HEADER_ICON_BUTTON } from "./header-icon-button";

export function NewThreadButton({ onClick }: { onClick: () => void }) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={t.threadMenu.newChat}
			className={cn(PARTS.newChat, HEADER_ICON_BUTTON)}
		>
			<SquarePenIcon className="ww:size-4" strokeWidth={1.75} aria-hidden />
		</button>
	);
}
