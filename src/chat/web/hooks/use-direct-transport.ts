"use client";

import { useRef, useState } from "react";
import type { ChatTransportFactory } from "../@types";
import { eveTransport } from "../lib/eve/transport";

/**
 * The chat engine builds its transport once, at mount, and an embed learns
 * `sessionApi` from its remote config later, so the transport reads it per turn.
 */
export function useDirectTransport(
	sessionApi: string | undefined,
): ChatTransportFactory {
	const latest = useRef(sessionApi);
	// Written during render: the engine asks whether a session is kept in the same pass.
	latest.current = sessionApi;
	const [factory] = useState(() => eveTransport(() => latest.current));
	return factory;
}
