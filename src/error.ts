// WaniWani SDK - Errors

export class WaniWaniError extends Error {
	constructor(
		message: string,
		public status: number,
	) {
		super(message);
		this.name = "WaniWaniError";
	}
}
