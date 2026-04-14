"use client";

import { useCallback, useEffect, useState } from "react";

type ScenarioPart = { type: string; [key: string]: unknown };
type ScenarioMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "data";
	parts: ScenarioPart[];
};
export type EvalScenario = {
	id: string;
	name: string;
	type?: "regulatory" | "functional" | "adversarial";
	mode?: "regenerate" | "inject";
	outcome?: { toolsCalled: string[] };
	messages: ScenarioMessage[];
};

export function useScenarios(api: string, enabled: boolean) {
	const [scenarios, setScenarios] = useState<EvalScenario[]>([]);
	const [isLoading, setIsLoading] = useState(false);

	const load = useCallback(() => {
		if (!enabled) {
			return;
		}
		setIsLoading(true);
		fetch(`${api}/scenarios`)
			.then((r) => r.json())
			.then((data) => setScenarios(Array.isArray(data) ? data : []))
			.catch(() => {})
			.finally(() => setIsLoading(false));
	}, [api, enabled]);

	useEffect(() => {
		load();
	}, [load]);

	const rename = useCallback(
		async (id: string, name: string) => {
			const res = await fetch(`${api}/scenarios/${id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name }),
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(
					data?.error ?? `Failed to rename scenario (${res.status})`,
				);
			}
			setScenarios((prev) =>
				prev.map((s) => (s.id === id ? { ...s, name } : s)),
			);
		},
		[api],
	);

	return { scenarios, isLoading, reload: load, rename };
}
