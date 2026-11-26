import type { RequestHandler } from "express";

/** A day: an icon changes with a deploy, and a directory fetches it rarely. */
const CACHE_CONTROL = "public, max-age=86400";

/** Whether `markup` is an SVG document, which is all `/favicon.svg` may serve. */
export function isSvgMarkup(markup: string): boolean {
	return /^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(markup);
}

/**
 * The `GET /favicon.svg` handler. The markup is the app's own, served as an
 * image under a CSP that runs none of it, so a script inside it stays inert
 * even when the file is opened directly.
 */
export function faviconHandler(markup: string): RequestHandler {
	return (_req, res) => {
		res
			.status(200)
			.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
			.set("X-Content-Type-Options", "nosniff")
			.set("Cache-Control", CACHE_CONTROL)
			.type("image/svg+xml")
			.send(markup);
	};
}

/**
 * `GET /favicon.ico`, for a reader that only asks for that name. It answers
 * with a redirect to the SVG, since there is no bitmap to serve.
 */
export const faviconRedirect: RequestHandler = (_req, res) => {
	res.set("Cache-Control", CACHE_CONTROL).redirect(302, "/favicon.svg");
};
