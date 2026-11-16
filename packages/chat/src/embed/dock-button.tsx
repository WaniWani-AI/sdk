import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { PARTS } from "../parts";
import type { PanelLayout } from "./config";

interface DockButtonProps {
	layout: PanelLayout;
	onToggle: () => void;
}

export function DockButton({ layout, onToggle }: DockButtonProps) {
	const { t } = useTranslation();
	const label = layout === "modal" ? t.launcher.dock : t.launcher.undock;
	const Icon = layout === "modal" ? PanelRightClose : PanelRightOpen;
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-label={label}
			title={label}
			data-layout={layout}
			className={cn(
				PARTS.dockToggle,
				"ww-hit ww:flex ww:size-7 ww:items-center ww:justify-center ww:rounded-md ww:text-muted-foreground ww:transition-colors ww:hover:bg-accent ww:hover:text-foreground ww:cursor-pointer",
			)}
		>
			<Icon className="ww:size-4" />
		</button>
	);
}
