// Shared helpers for chat server handlers

export type CorsFunction = (response: Response) => Response;

export function createCors(): CorsFunction {
	return function applyCors(response: Response): Response {
		response.headers.set("Access-Control-Allow-Origin", "*");
		response.headers.set(
			"Access-Control-Allow-Methods",
			"GET, POST, PATCH, OPTIONS",
		);
		response.headers.set(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization, X-Session-Id, X-Client-User-Agent",
		);
		response.headers.set("Access-Control-Expose-Headers", "X-Session-Id");
		return response;
	};
}

export function createJsonResponse(cors: CorsFunction) {
	return function json(data: object, status: number): Response {
		return cors(
			new Response(JSON.stringify(data), {
				headers: { "Content-Type": "application/json" },
				status,
			}),
		);
	};
}
