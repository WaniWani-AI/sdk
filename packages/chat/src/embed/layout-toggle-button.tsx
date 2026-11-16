import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { PARTS } from "../parts";
import type { PanelLayout } from "./config";

interface LayoutToggleButtonProps {
	layout: PanelLayout;
	onToggle: () => void;
}

export function LayoutToggleButton({
	layout,
	onToggle,
}: LayoutToggleButtonProps) {
	const { t } = useTranslation();
	const label = layout === "modal" ? t.launcher.toSidebar : t.launcher.toModal;
	const Icon = layout === "modal" ? PanelRightClose : PanelRightOpen;
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-label={label}
			title={label}
			data-layout={layout}
			className={cn(
				PARTS.layoutToggle,
				"ww-hit ww:flex ww:size-7 ww:items-center ww:justify-center ww:rounded-md ww:text-muted-foreground ww:transition-colors ww:hover:bg-accent ww:hover:text-foreground ww:cursor-pointer",
			)}
		>
			<Icon className="ww:size-4" />
		</button>
	);
}
