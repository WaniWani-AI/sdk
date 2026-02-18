"use client";

import { Component, type ReactNode } from "react";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
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
				<div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
					<span>Widget failed to load</span>
					<button
						type="button"
						onClick={() => this.setState({ hasError: false })}
						className="text-xs font-medium text-primary hover:underline"
					>
						Retry
					</button>
				</div>
			);
		}

		return this.props.children;
	}
}
