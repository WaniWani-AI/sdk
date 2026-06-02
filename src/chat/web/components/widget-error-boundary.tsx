"use client";

import { Component, type ReactNode } from "react";
import { useTranslation } from "../i18n";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
	const { t } = useTranslation();
	return (
		<div className="ww:flex ww:items-center ww:justify-between ww:rounded-md ww:border ww:border-border ww:bg-muted/50 ww:px-4 ww:py-3 ww:text-sm ww:text-muted-foreground">
			<span>{t.widgetErrorBoundary.failedToLoad}</span>
			<button
				type="button"
				onClick={onRetry}
				className="ww:text-xs ww:font-medium ww:text-primary ww:hover:underline"
			>
				{t.widgetErrorBoundary.retry}
			</button>
		</div>
	);
}

export class WidgetErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError(): State {
		return { hasError: true };
	}

	componentDidCatch(error: Error) {
		console.warn("[WaniWani] Widget failed to render:", error.message);
	}

	render() {
		if (this.state.hasError) {
			return (
				<ErrorFallback onRetry={() => this.setState({ hasError: false })} />
			);
		}

		return this.props.children;
	}
}
