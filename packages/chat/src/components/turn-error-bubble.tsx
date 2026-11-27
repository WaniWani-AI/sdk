"use client";

import { useEffect, useState } from "react";
import { MessageContent } from "../ai-elements/message";
import type { TurnError } from "../hooks/use-chat-engine";
import { useTranslation } from "../i18n";
import { Button } from "../ui/button";

function useSecondsUntil(target: number | undefined): number {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (target === undefined) {
			return;
		}
		setNow(Date.now());
		const timer = setInterval(() => {
			const tick = Date.now();
			setNow(tick);
			if (tick >= target) {
				clearInterval(timer);
			}
		}, 1000);
		return () => clearInterval(timer);
	}, [target]);

	return target === undefined
		? 0
		: Math.max(0, Math.ceil((target - now) / 1000));
}

export function TurnErrorBubble({
	error,
	onRetry,
}: {
	error: TurnError;
	onRetry: () => void;
}) {
	const { t } = useTranslation();
	const retryAt = error.kind === "rate_limited" ? error.retryAt : undefined;
	const seconds = useSecondsUntil(retryAt);

	const wait =
		error.kind !== "rate_limited"
			? undefined
			: seconds >= 60
				? t.turnError.tryAgainInMinutes(Math.ceil(seconds / 60))
				: seconds > 0
					? t.turnError.tryAgainInSeconds(seconds)
					: retryAt === undefined
						? t.turnError.waitAMoment
						: undefined;

	return (
		<MessageContent>
			<p role="alert" className="ww:m-0">
				{error.kind === "rate_limited"
					? t.turnError.rateLimited
					: t.turnError.failed}
			</p>
			{wait && <p className="ww:m-0 ww:text-muted-foreground">{wait}</p>}
			<Button
				variant="outline"
				size="sm"
				className="ww:self-start"
				disabled={seconds > 0}
				onClick={onRetry}
			>
				{t.turnError.retry}
			</Button>
		</MessageContent>
	);
}
