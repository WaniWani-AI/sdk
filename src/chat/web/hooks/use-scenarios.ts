"use client";

import { useCallback, useEffect, useState } from "react";

type ScenarioPart = { type: string; [key: string]: unknown };
type ScenarioMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "data";
	parts: ScenarioPart[];
};
export type EvalScenario = {
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
			.then((data: EvalScenario[]) => setScenarios(data))
			.catch(() => {})
			.finally(() => setIsLoading(false));
	}, [api, enabled]);

	useEffect(() => {
		load();
	}, [load]);

	return { scenarios, isLoading, reload: load };
}
