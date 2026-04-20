"use client";

import { useEffect, useRef, useState } from "react";

export interface WaniWaniConfig {
	debug: boolean;
	eval: boolean;
}

const defaultConfig: WaniWaniConfig = { debug: false, eval: false };

export function useConfig(
	api = "/api/waniwani",
	headers?: Record<string, string>,
	skip = false,
): WaniWaniConfig {
	const [config, setConfig] = useState<WaniWaniConfig>(defaultConfig);

	// Keep headers in a ref so identity changes don't re-trigger the fetch.
	// Callers commonly pass a fresh object literal each render.
	const headersRef = useRef(headers);
	useEffect(() => {
		headersRef.current = headers;
	}, [headers]);

	useEffect(() => {
		if (skip) {
			return;
		}
		(async () => {
			try {
				const current = headersRef.current;
				const r = await fetch(`${api}/config`, {
					headers: current ? { ...current } : undefined,
				});
				const data = await r.json();
				setConfig({
					debug: data.debug === true,
					eval: data.eval === true,
				});
			} catch {}
		})();
	}, [api, skip]);

	return config;
}
