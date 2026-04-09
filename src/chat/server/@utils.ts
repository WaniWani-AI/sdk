// Shared helpers for chat server handlers

export type CorsFunction = (response: Response, request?: Request) => Response;

function isLocalhostOrigin(origin: string): boolean {
	try {
		const url = new URL(origin);
		return url.hostname === "localhost" || url.hostname === "127.0.0.1";
	} catch {
		return false;
	}
}

export function createCors(allowedOrigins: string[]): CorsFunction {
	const originSet = new Set(
		allowedOrigins.map((o) => o.replace(/\/$/, "").toLowerCase()),
	);

	return function applyCors(response: Response, request?: Request): Response {
		const requestOrigin = request?.headers.get("origin");
		const origin = requestOrigin?.toLowerCase();
		const isAllowed =
			origin != null &&
			(originSet.has(origin) ||
				origin.endsWith(".mcp.waniwani.run") ||
				isLocalhostOrigin(origin));

		if (!isAllowed) {
			return response;
		}

		response.headers.set(
			"Access-Control-Allow-Origin",
			requestOrigin as string,
		);
		response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		response.headers.set(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization, X-Session-Id, X-Client-User-Agent",
		);
		response.headers.set("Access-Control-Expose-Headers", "X-Session-Id");
		response.headers.set("Vary", "Origin");
		return response;
	};
}

export function createJsonResponse(cors: CorsFunction) {
	return function json(
		data: object,
		status: number,
		request?: Request,
	): Response {
		return cors(
			new Response(JSON.stringify(data), {
				headers: { "Content-Type": "application/json" },
				status,
			}),
			request,
		);
	};
}
