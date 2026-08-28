import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLFormElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"MutationObserver",
	"customElements",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"DragEvent",
	"ClipboardEvent",
	"FormData",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(win as any).SyntaxError = SyntaxError;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const revoked: string[] = [];
let objectUrlSeq = 0;
// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no object-URL store
(URL as any).createObjectURL = () =>
	`blob:https://shop.example.com/${++objectUrlSeq}`;
// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no object-URL store
(URL as any).revokeObjectURL = (url: string) => revoked.push(url);

const { act, createElement, Fragment } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

const {
	PromptInput,
	PromptInputAddAttachments,
	PromptInputAttachments,
	PromptInputDropOverlay,
	PromptInputSubmit,
	PromptInputTextarea,
	usePromptInputAttachments,
} = await import("./prompt-input");
type PromptInputPropsType = import("./prompt-input").PromptInputProps;
type MessageType = import("./prompt-input").PromptInputMessage;
type ErrorType = import("./prompt-input").AttachmentError;
type AttachmentsCtx = import("./prompt-input").AttachmentsContext;
type UploadedDoc = import("../../../documents/types").AttachedDocument;

function file(name: string, type: string, size = 8): File {
	return new File(["x".repeat(size)], name, { type });
}

interface Deferred {
	promise: Promise<UploadedDoc>;
	resolve: (value: UploadedDoc) => void;
	reject: (error: unknown) => void;
}

function deferred(): Deferred {
	let resolve!: (value: UploadedDoc) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<UploadedDoc>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

let root: Root;
let container: HTMLElement;
let ctx: AttachmentsCtx | null = null;
let submissions: MessageType[] = [];
let errors: ErrorType[] = [];

function Probe() {
	ctx = usePromptInputAttachments();
	return null;
}

function mount(props: Partial<PromptInputPropsType> = {}) {
	act(() => {
		root.render(
			createElement(
				PromptInput,
				{
					onSubmit: (message: MessageType) => {
						submissions.push(message);
					},
					onError: (error: ErrorType) => {
						errors.push(error);
					},
					...props,
				} as PromptInputPropsType,
				createElement(Fragment, null, [
					createElement(Probe, { key: "probe" }),
					createElement(PromptInputAttachments, { key: "chips" }),
					createElement(PromptInputAddAttachments, { key: "add" }),
					createElement(PromptInputTextarea, { key: "text" }),
					createElement(PromptInputSubmit, { key: "submit" }),
				]),
			),
		);
	});
}

function attachments(): AttachmentsCtx {
	if (!ctx) {
		throw new Error("PromptInput not mounted");
	}
	return ctx;
}

function submit() {
	const form = container.querySelector("form");
	if (!form) {
		throw new Error("no form rendered");
	}
	act(() => {
		form.dispatchEvent(
			new win.Event("submit", {
				bubbles: true,
				cancelable: true,
			}) as unknown as Event,
		);
	});
}

async function settle(ms = 20) {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});
}

beforeEach(() => {
	ctx = null;
	submissions = [];
	errors = [];
	revoked.length = 0;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

describe("PromptInput — every attachment path goes through add()", () => {
	test("picking a file starts its upload straight away", async () => {
		const seen: File[] = [];
		mount({
			upload: async (f) => {
				seen.push(f);
				return {
					documentId: "doc_1",
					filename: f.name,
					mediaType: f.type,
				};
			},
		});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();

		expect(seen.map((f) => f.name)).toEqual(["policy.pdf"]);
		expect(attachments().files[0]?.documentId).toBe("doc_1");
		expect(attachments().files[0]?.status).toBe("ready");
	});

	test("pasting a file adds it, the same as the paperclip does", async () => {
		mount({
			upload: async (f) => ({
				documentId: "doc_paste",
				filename: f.name,
				mediaType: f.type,
			}),
		});

		const textarea = container.querySelector("textarea");
		if (!textarea) {
			throw new Error("no textarea");
		}
		const pasted = file("screenshot.png", "image/png");
		act(() => {
			const event = new win.Event("paste", {
				bubbles: true,
				cancelable: true,
			});
			// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no ClipboardEvent ctor with items
			(event as any).clipboardData = {
				items: [{ kind: "file", getAsFile: () => pasted }],
			};
			textarea.dispatchEvent(event as unknown as Event);
		});
		await settle();

		expect(attachments().files.map((f) => f.filename)).toEqual([
			"screenshot.png",
		]);
	});

	test("a drop on the page adds the files when globalDrop is on", async () => {
		mount({ globalDrop: true });

		const dropped = file("scan.png", "image/png");
		act(() => {
			const event = new win.Event("drop", { bubbles: true, cancelable: true });
			// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no DataTransfer
			(event as any).dataTransfer = {
				types: ["Files"],
				files: [dropped],
			};
			document.dispatchEvent(event as unknown as Event);
		});
		await settle();

		expect(attachments().files.map((f) => f.filename)).toEqual(["scan.png"]);
	});
});

describe("PromptInput — attachmentsEnabled gates picker, drop and paste together", () => {
	test("add() is inert while attachments are off", async () => {
		let uploads = 0;
		mount({
			attachmentsEnabled: false,
			upload: async (f) => {
				uploads += 1;
				return { documentId: "doc_1", filename: f.name, mediaType: f.type };
			},
		});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();

		expect(attachments().files).toEqual([]);
		expect(uploads).toBe(0);
		expect(errors).toEqual([]);
	});

	test("pasting a file while attachments are off attaches nothing", async () => {
		mount({ attachmentsEnabled: false });

		const textarea = container.querySelector("textarea");
		if (!textarea) {
			throw new Error("no textarea");
		}
		act(() => {
			const event = new win.Event("paste", {
				bubbles: true,
				cancelable: true,
			});
			// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no ClipboardEvent ctor with items
			(event as any).clipboardData = {
				items: [{ kind: "file", getAsFile: () => file("a.png", "image/png") }],
			};
			textarea.dispatchEvent(event as unknown as Event);
		});
		await settle();

		expect(attachments().files).toEqual([]);
	});

	test("a page drop while attachments are off attaches nothing", async () => {
		mount({ attachmentsEnabled: false, globalDrop: true });

		act(() => {
			const event = new win.Event("drop", { bubbles: true, cancelable: true });
			// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no DataTransfer
			(event as any).dataTransfer = {
				types: ["Files"],
				files: [file("a.png", "image/png")],
			};
			document.dispatchEvent(event as unknown as Event);
		});
		await settle();

		expect(attachments().files).toEqual([]);
	});
});

describe("PromptInput — a refused file is reported, never silently dropped", () => {
	test("a type outside accept is reported by name and not attached", async () => {
		mount({ accept: "application/pdf,image/png" });

		act(() => {
			attachments().add([file("virus.exe", "application/x-msdownload")]);
		});
		await settle();

		expect(attachments().files).toEqual([]);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.code).toBe("accept");
		expect(errors[0]?.message).toContain("virus.exe");
	});

	test("an extension pattern and a wildcard both match the way the picker would", async () => {
		mount({ accept: ".pdf,image/*" });

		act(() => {
			attachments().add([
				file("report.pdf", ""),
				file("photo.jpeg", "image/jpeg"),
				file("notes.txt", "text/plain"),
			]);
		});
		await settle();

		expect(attachments().files.map((f) => f.filename)).toEqual([
			"report.pdf",
			"photo.jpeg",
		]);
		expect(errors.map((e) => e.code)).toEqual(["accept"]);
	});

	test("a file over the limit is reported with the limit spelled out", async () => {
		mount({ maxFileSize: 1024 });

		act(() => {
			attachments().add([file("huge.pdf", "application/pdf", 2048)]);
		});
		await settle();

		expect(attachments().files).toEqual([]);
		expect(errors[0]?.code).toBe("max_file_size");
		expect(errors[0]?.message).toContain("huge.pdf");
		expect(errors[0]?.message).toContain("1 KB");
	});

	test("the admitted prefix is kept when the batch exceeds maxFiles", async () => {
		const uploaded: string[] = [];
		mount({
			maxFiles: 2,
			upload: async (f) => {
				uploaded.push(f.name);
				return { documentId: f.name, filename: f.name, mediaType: f.type };
			},
		});

		act(() => {
			attachments().add([
				file("a.pdf", "application/pdf"),
				file("b.pdf", "application/pdf"),
				file("c.pdf", "application/pdf"),
			]);
		});
		await settle();

		expect(attachments().files.map((f) => f.filename)).toEqual([
			"a.pdf",
			"b.pdf",
		]);
		expect(uploaded).toEqual(["a.pdf", "b.pdf"]);
		expect(errors[0]?.code).toBe("max_files");
		expect(errors[0]?.message).toContain("2");
	});

	test("a mixed batch attaches the good file and reports the bad one", async () => {
		mount({ accept: "application/pdf", maxFileSize: 4096 });

		act(() => {
			attachments().add([
				file("good.pdf", "application/pdf", 100),
				file("wrong-type.png", "image/png", 100),
				file("too-big.pdf", "application/pdf", 9000),
			]);
		});
		await settle();

		expect(attachments().files.map((f) => f.filename)).toEqual(["good.pdf"]);
		expect(errors.map((e) => e.code).sort()).toEqual([
			"accept",
			"max_file_size",
		]);
	});
});

describe("PromptInput — upload lifecycle", () => {
	test("an uploaded attachment travels as a document id, never as bytes", async () => {
		mount({
			upload: async (f) => ({
				documentId: "doc_1",
				filename: f.name,
				mediaType: f.type,
			}),
		});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();
		submit();
		await settle();

		expect(submissions).toHaveLength(1);
		expect(submissions[0]?.documents).toEqual([
			{
				documentId: "doc_1",
				filename: "policy.pdf",
				mediaType: "application/pdf",
			},
		]);
		expect(submissions[0]?.files).toEqual([]);
	});

	test("submit waits for an upload still in flight and still sends only the id", async () => {
		const pending = deferred();
		mount({ upload: () => pending.promise });

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();

		submit();
		await settle();
		expect(submissions).toHaveLength(0);

		await act(async () => {
			pending.resolve({
				documentId: "doc_late",
				filename: "policy.pdf",
				mediaType: "application/pdf",
			});
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		await settle();

		expect(submissions).toHaveLength(1);
		expect(submissions[0]?.documents).toEqual([
			{
				documentId: "doc_late",
				filename: "policy.pdf",
				mediaType: "application/pdf",
			},
		]);
		expect(submissions[0]?.files).toEqual([]);
	});

	test("progress from the uploader lands on the item", async () => {
		const pending = deferred();
		let report: ((fraction: number) => void) | undefined;
		mount({
			upload: (_f, _signal, onProgress) => {
				report = onProgress;
				return pending.promise;
			},
		});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();

		expect(attachments().files[0]?.status).toBe("uploading");
		act(() => {
			report?.(0.5);
		});
		expect(attachments().files[0]?.progress).toBe(0.5);
	});

	test("a failed upload is reported and blocks the send rather than silently dropping the file", async () => {
		const pending = deferred();
		mount({ upload: () => pending.promise });

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();

		await act(async () => {
			pending.reject(new Error("That file is too large."));
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		expect(attachments().files[0]?.status).toBe("failed");
		expect(errors.map((e) => e.code)).toEqual(["upload_failed"]);
		expect(errors[0]?.message).toBe("That file is too large.");

		submit();
		await settle();

		expect(submissions).toHaveLength(0);
		expect(errors.map((e) => e.code)).toEqual([
			"upload_failed",
			"upload_failed",
		]);
		expect(attachments().files).toHaveLength(1);
	});

	test("removing the file that failed unblocks the send", async () => {
		const pending = deferred();
		mount({ upload: () => pending.promise });

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();
		await act(async () => {
			pending.reject(new Error("storage refused"));
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		const id = attachments().files[0]?.id;
		if (!id) {
			throw new Error("no attachment id");
		}
		act(() => {
			attachments().remove(id);
		});

		submit();
		await settle();

		expect(submissions).toHaveLength(1);
		expect(submissions[0]?.documents).toEqual([]);
		expect(submissions[0]?.files).toEqual([]);
	});

	test("retry() restarts a failed upload and the id then travels", async () => {
		let attempt = 0;
		const first = deferred();
		const second = deferred();
		mount({
			upload: () => {
				attempt += 1;
				return attempt === 1 ? first.promise : second.promise;
			},
		});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();
		await act(async () => {
			first.reject(new Error("network"));
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		expect(attachments().files[0]?.status).toBe("failed");

		const id = attachments().files[0]?.id;
		if (!id) {
			throw new Error("no attachment id");
		}
		act(() => {
			attachments().retry(id);
		});
		expect(attempt).toBe(2);
		expect(attachments().files[0]?.status).toBe("uploading");

		await act(async () => {
			second.resolve({
				documentId: "doc_retry",
				filename: "policy.pdf",
				mediaType: "application/pdf",
			});
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		expect(attachments().files[0]?.documentId).toBe("doc_retry");
		expect(attachments().files[0]?.status).toBe("ready");
	});

	test("remove() aborts the upload it was still running", async () => {
		const pending = deferred();
		let signal: AbortSignal | undefined;
		mount({
			upload: (_f, s) => {
				signal = s;
				return pending.promise;
			},
		});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();

		const id = attachments().files[0]?.id;
		if (!id) {
			throw new Error("no attachment id");
		}
		act(() => {
			attachments().remove(id);
		});

		expect(signal?.aborted).toBe(true);
		expect(attachments().files).toEqual([]);
		expect(revoked).toHaveLength(1);
	});

	test("an aborted upload never reports an error to the visitor", async () => {
		const pending = deferred();
		mount({ upload: () => pending.promise });

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();
		const id = attachments().files[0]?.id;
		if (!id) {
			throw new Error("no attachment id");
		}
		act(() => {
			attachments().remove(id);
		});
		await act(async () => {
			pending.reject(new Error("aborted"));
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		expect(errors).toEqual([]);
	});

	test("a successful submit clears the composer's attachments", async () => {
		mount({
			upload: async (f) => ({
				documentId: "doc_1",
				filename: f.name,
				mediaType: f.type,
			}),
		});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();
		submit();
		await settle();

		expect(attachments().files).toEqual([]);
	});
});

describe("PromptInput — without an uploader the inline path is unchanged", () => {
	test("attachments travel as files, and documents stays empty", async () => {
		mount({});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();

		expect(attachments().files[0]?.status).toBe("ready");
		expect(attachments().files[0]?.documentId).toBeUndefined();

		submit();
		await settle();

		expect(submissions[0]?.documents).toEqual([]);
		expect(submissions[0]?.files).toHaveLength(1);
		expect(submissions[0]?.files[0]?.filename).toBe("policy.pdf");
	});
});

describe("PromptInput — the stated size limit reads the way the platform configures it", () => {
	test("a 20 MB cap is spelled out in megabytes, not bytes", async () => {
		mount({ maxFileSize: 20 * 1024 * 1024 });

		act(() => {
			attachments().add([
				file("huge.pdf", "application/pdf", 21 * 1024 * 1024),
			]);
		});
		await settle();

		expect(errors[0]?.message).toContain("20 MB");
	});
});

describe("PromptInput — a batch that half succeeds", () => {
	test("one failure holds the whole message back; dropping it lets the good id travel alone", async () => {
		const good = deferred();
		const bad = deferred();
		let call = 0;
		mount({
			upload: () => {
				call += 1;
				return call === 1 ? good.promise : bad.promise;
			},
		});

		act(() => {
			attachments().add([
				file("good.pdf", "application/pdf"),
				file("bad.pdf", "application/pdf"),
			]);
		});
		await settle();

		await act(async () => {
			good.resolve({
				documentId: "doc_good",
				filename: "good.pdf",
				mediaType: "application/pdf",
			});
			bad.reject(new Error("storage refused"));
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		submit();
		await settle();
		expect(submissions).toHaveLength(0);

		const failed = attachments().files.find((f) => f.status === "failed");
		if (!failed) {
			throw new Error("expected a failed attachment");
		}
		act(() => {
			attachments().remove(failed.id);
		});

		submit();
		await settle();

		expect(submissions[0]?.documents).toEqual([
			{
				documentId: "doc_good",
				filename: "good.pdf",
				mediaType: "application/pdf",
			},
		]);
		expect(submissions[0]?.files).toEqual([]);
	});

	test("uploads from two separate batches are all waited for", async () => {
		const first = deferred();
		const second = deferred();
		let call = 0;
		mount({
			upload: () => {
				call += 1;
				return call === 1 ? first.promise : second.promise;
			},
		});

		act(() => {
			attachments().add([file("a.pdf", "application/pdf")]);
		});
		await settle();
		act(() => {
			attachments().add([file("b.pdf", "application/pdf")]);
		});
		await settle();

		submit();
		await settle();
		expect(submissions).toHaveLength(0);

		await act(async () => {
			first.resolve({
				documentId: "doc_a",
				filename: "a.pdf",
				mediaType: "application/pdf",
			});
			second.resolve({
				documentId: "doc_b",
				filename: "b.pdf",
				mediaType: "application/pdf",
			});
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		await settle();

		expect(submissions[0]?.documents?.map((d) => d.documentId)).toEqual([
			"doc_a",
			"doc_b",
		]);
	});

	test("maxFiles counts what is already attached, not just the new batch", async () => {
		const uploaded: string[] = [];
		mount({
			maxFiles: 2,
			upload: async (f) => {
				uploaded.push(f.name);
				return { documentId: f.name, filename: f.name, mediaType: f.type };
			},
		});

		act(() => {
			attachments().add([file("a.pdf", "application/pdf")]);
		});
		await settle();
		act(() => {
			attachments().add([
				file("b.pdf", "application/pdf"),
				file("c.pdf", "application/pdf"),
			]);
		});
		await settle();

		expect(attachments().files.map((f) => f.filename)).toEqual([
			"a.pdf",
			"b.pdf",
		]);
		expect(uploaded).toEqual(["a.pdf", "b.pdf"]);
		expect(errors.map((e) => e.code)).toEqual(["max_files"]);
	});

	test("a cap of zero refuses every file, which is why parsing must not pass one on", async () => {
		mount({ maxFiles: 0 });

		act(() => {
			attachments().add([
				file("a.pdf", "application/pdf"),
				file("b.pdf", "application/pdf"),
			]);
		});
		await settle();

		expect(attachments().files).toEqual([]);
		expect(errors.map((e) => e.code)).toEqual(["max_files"]);
	});

	test("no cap at all leaves the composer unbounded", async () => {
		mount({});

		act(() => {
			attachments().add([
				file("a.pdf", "application/pdf"),
				file("b.pdf", "application/pdf"),
				file("c.pdf", "application/pdf"),
			]);
		});
		await settle();

		expect(attachments().files).toHaveLength(3);
		expect(errors).toEqual([]);
	});

	test("a text-only message carries no documents and no files", async () => {
		mount({
			upload: async (f) => ({
				documentId: "doc_1",
				filename: f.name,
				mediaType: f.type,
			}),
		});

		submit();
		await settle();

		expect(submissions[0]?.documents).toEqual([]);
		expect(submissions[0]?.files).toEqual([]);
	});
});

describe("PromptInput — an attachment removed while the message is being sent", () => {
	test("its id does not travel with the message", async () => {
		mount({
			upload: (_f, signal) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				}),
		});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();
		const id = attachments().files[0]?.id;
		if (!id) {
			throw new Error("no attachment id");
		}

		submit();
		await settle();
		expect(submissions).toHaveLength(0);

		act(() => {
			attachments().remove(id);
		});
		await settle();

		expect(submissions).toHaveLength(1);
		expect(submissions[0]?.documents).toEqual([]);
		expect(submissions[0]?.files).toEqual([]);
		expect(errors).toEqual([]);
	});
});

describe("PromptInput — what the visitor sees", () => {
	test("one chip per attachment, named after the file", async () => {
		mount({});

		act(() => {
			attachments().add([
				file("policy.pdf", "application/pdf"),
				file("scan.png", "image/png"),
			]);
		});
		await settle();

		expect(container.textContent).toContain("policy.pdf");
		expect(container.textContent).toContain("scan.png");
	});

	test("a failed upload offers a retry the visitor can click", async () => {
		const first = deferred();
		const second = deferred();
		let call = 0;
		mount({
			upload: () => {
				call += 1;
				return call === 1 ? first.promise : second.promise;
			},
		});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();
		await act(async () => {
			first.reject(new Error("network"));
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		const retryButton = container.querySelector(
			'button[aria-label="Retry the upload"]',
		);
		expect(retryButton).not.toBeNull();

		act(() => {
			retryButton?.dispatchEvent(
				new win.Event("click", {
					bubbles: true,
					cancelable: true,
				}) as unknown as Event,
			);
		});

		expect(call).toBe(2);
		expect(attachments().files[0]?.status).toBe("uploading");
	});

	test("the remove control on a chip detaches it", async () => {
		mount({});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();

		const removeButton = container.querySelector(
			'button[aria-label="Remove attachment"]',
		);
		expect(removeButton).not.toBeNull();
		act(() => {
			removeButton?.dispatchEvent(
				new win.Event("click", {
					bubbles: true,
					cancelable: true,
				}) as unknown as Event,
			);
		});

		expect(attachments().files).toEqual([]);
	});
});

function drag(type: string, types: string[]) {
	act(() => {
		const event = new win.Event(type, { bubbles: true, cancelable: true });
		// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no DataTransfer
		(event as any).dataTransfer = { types, files: [] };
		document.dispatchEvent(event as unknown as Event);
	});
}

function mountOverlay(enabled: boolean) {
	act(() => {
		root.render(
			createElement(
				PromptInput,
				{
					onSubmit: () => {},
					attachmentsEnabled: enabled,
				} as PromptInputPropsType,
				createElement(PromptInputDropOverlay, { enabled }),
			),
		);
	});
}

describe("PromptInputDropOverlay", () => {
	test("appears while files are dragged over the page and clears on drop", () => {
		mountOverlay(true);

		drag("dragenter", ["Files"]);
		expect(container.textContent).toContain("Drop to attach");

		drag("drop", ["Files"]);
		expect(container.textContent).not.toContain("Drop to attach");
	});

	test("survives dragging across child elements without flickering off", () => {
		mountOverlay(true);

		drag("dragenter", ["Files"]);
		drag("dragenter", ["Files"]);
		drag("dragleave", ["Files"]);
		expect(container.textContent).toContain("Drop to attach");

		drag("dragleave", ["Files"]);
		expect(container.textContent).not.toContain("Drop to attach");
	});

	test("ignores a drag that carries no files", () => {
		mountOverlay(true);

		drag("dragenter", ["text/plain"]);
		expect(container.textContent).not.toContain("Drop to attach");
	});

	test("never appears while attachments are off", () => {
		mountOverlay(false);

		drag("dragenter", ["Files"]);
		expect(container.textContent).not.toContain("Drop to attach");
	});
});

// ---------------------------------------------------------------------------
// The paperclip: the only place the size cap is stated before the picker opens
// ---------------------------------------------------------------------------

/** Only the paperclip, so no chip or submit button can be mistaken for it. */
function mountPaperclip(props: Partial<PromptInputPropsType> = {}) {
	act(() => {
		root.render(
			createElement(
				PromptInput,
				{
					onSubmit: (message: MessageType) => {
						submissions.push(message);
					},
					...props,
				} as PromptInputPropsType,
				createElement(Fragment, null, [
					createElement(Probe, { key: "probe" }),
					createElement(PromptInputAddAttachments, { key: "add" }),
				]),
			),
		);
	});
}

function paperclip(): HTMLElement {
	const buttons = container.querySelectorAll("button");
	if (buttons.length !== 1) {
		throw new Error(`expected one button, found ${buttons.length}`);
	}
	return buttons[0] as unknown as HTMLElement;
}

function paperclipLabel(): string {
	return paperclip().getAttribute("aria-label") ?? "";
}

describe("PromptInputAddAttachments — the picker cannot filter by size, so the label states the cap", () => {
	test("the label spells out the configured cap", () => {
		mountPaperclip({ maxFileSize: 20 * 1024 * 1024 });

		expect(paperclipLabel()).toContain("20 MB");
		expect(paperclipLabel()).not.toContain("{limit}");
	});

	test("a different cap moves the label with it", () => {
		mountPaperclip({ maxFileSize: 20 * 1024 * 1024 });
		const twenty = paperclipLabel();

		mountPaperclip({ maxFileSize: 3 * 1024 * 1024 });
		const three = paperclipLabel();

		expect(three).not.toBe(twenty);
		expect(three).toContain("3 MB");
		expect(three).not.toContain("20 MB");

		mountPaperclip({ maxFileSize: 512 * 1024 });
		expect(paperclipLabel()).toContain("512 KB");
	});

	test("the cap the label states is the cap add() enforces", () => {
		mountPaperclip({ maxFileSize: 1024 });

		expect(paperclipLabel()).toContain("1 KB");
		act(() => {
			attachments().add([file("huge.pdf", "application/pdf", 2048)]);
		});
		expect(attachments().files).toEqual([]);
	});

	test("with no cap configured the label falls back and nothing is enforced", () => {
		mountPaperclip({});

		expect(paperclipLabel()).toBe("Upload files");
		act(() => {
			attachments().add([file("huge.pdf", "application/pdf", 50_000_000)]);
		});
		expect(attachments().files).toHaveLength(1);
	});

	test("a cap of zero states no limit, matching that it enforces none", () => {
		mountPaperclip({ maxFileSize: 0 });

		expect(paperclipLabel()).toBe("Upload files");
		act(() => {
			attachments().add([file("huge.pdf", "application/pdf", 50_000_000)]);
		});
		expect(attachments().files).toHaveLength(1);
	});

	test("the tooltip says what the screen reader hears, since sighted visitors only get the tooltip", () => {
		mountPaperclip({ maxFileSize: 20 * 1024 * 1024 });

		expect(paperclip().getAttribute("title")).toBe(paperclipLabel());
	});
});

describe("PromptInputAddAttachments — an icon-only button still announces itself", () => {
	test("the attach state has an accessible name", () => {
		mountPaperclip({});

		expect(paperclip().textContent).toBe("");
		expect(paperclipLabel().length).toBeGreaterThan(0);
	});

	test("the clear state has an accessible name", async () => {
		mountPaperclip({});

		act(() => {
			attachments().add([file("policy.pdf", "application/pdf")]);
		});
		await settle();

		expect(paperclipLabel()).toBe("Remove all attachments");
	});
});
