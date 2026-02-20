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
				<div className="ww:flex ww:items-center ww:justify-between ww:rounded-md ww:border ww:border-border ww:bg-muted/50 ww:px-4 ww:py-3 ww:text-sm ww:text-muted-foreground">
					<span>Widget failed to load</span>
					<button
						type="button"
						onClick={() => this.setState({ hasError: false })}
						className="ww:text-xs ww:font-medium ww:text-primary ww:hover:underline"
					>
						Retry
					</button>
				</div>
			);
		}

		return this.props.children;
	}
}
