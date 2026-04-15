"use client";

import { useEffect, useState } from "react";

export interface WaniWaniConfig {
	debug: boolean;
	eval: boolean;
}

const defaultConfig: WaniWaniConfig = { debug: false, eval: false };

export function useConfig(
	api = "/api/waniwani",
	headers?: Record<string, string>,
): WaniWaniConfig {
	const [config, setConfig] = useState<WaniWaniConfig>(defaultConfig);

	useEffect(() => {
		(async () => {
			try {
				const r = await fetch(`${api}/config`, {
					headers: headers ? { ...headers } : undefined,
				});
				const data = await r.json();
				setConfig({
					debug: data.debug === true,
					eval: data.eval === true,
				});
			} catch {}
		})();
	}, [api, headers]);

	return config;
}
