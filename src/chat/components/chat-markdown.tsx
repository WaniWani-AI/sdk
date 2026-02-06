/**
 * Minimal markdown renderer. Handles bold, italic, inline code, code blocks,
 * links, and unordered lists. No external dependencies.
 */
export function ChatMarkdown(props: { text: string }) {
	const blocks = props.text.split(/\n\n+/);

	return (
		<>
			{blocks.map((block, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static parsed text blocks
				<MarkdownBlock key={i} block={block.trim()} />
			))}
		</>
	);
}

function MarkdownBlock(props: { block: string }) {
	const { block } = props;

	// Code block
	if (block.startsWith("```")) {
		const lines = block.split("\n");
		const code = lines.slice(1, -1).join("\n");
		return (
			<pre
				style={{
					backgroundColor: "var(--ww-border)",
					borderRadius: "6px",
					padding: "8px 12px",
					overflowX: "auto",
					fontSize: "13px",
					lineHeight: 1.5,
					margin: "4px 0",
				}}
			>
				<code>{code}</code>
			</pre>
		);
	}

	// Unordered list
	if (/^[-*]\s/.test(block)) {
		const items = block.split(/\n/).filter((l) => /^[-*]\s/.test(l));
		return (
			<ul style={{ paddingLeft: "20px", margin: "4px 0" }}>
				{items.map((item, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static list items
					<li key={i}>
						<InlineMarkdown text={item.replace(/^[-*]\s/, "")} />
					</li>
				))}
			</ul>
		);
	}

	// Paragraph
	return (
		<p style={{ margin: "4px 0", lineHeight: 1.5 }}>
			<InlineMarkdown text={block} />
		</p>
	);
}

function InlineMarkdown(props: { text: string }) {
	const parts = parseInline(props.text);
	return (
		<>
			{parts.map((part, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static inline parsed parts
				<InlinePart key={i} part={part} />
			))}
		</>
	);
}

function InlinePart(props: { part: InlinePartData }) {
	const { part } = props;
	if (part.type === "text") return <span>{part.value}</span>;
	if (part.type === "bold")
		return <strong style={{ fontWeight: 600 }}>{part.value}</strong>;
	if (part.type === "italic") return <em>{part.value}</em>;
	if (part.type === "code")
		return (
			<code
				style={{
					backgroundColor: "var(--ww-border)",
					borderRadius: "3px",
					padding: "1px 4px",
					fontSize: "0.9em",
				}}
			>
				{part.value}
			</code>
		);
	if (part.type === "link")
		return (
			<a
				href={part.href}
				target="_blank"
				rel="noopener noreferrer"
				style={{
					color: "var(--ww-primary)",
					textDecoration: "underline",
				}}
			>
				{part.value}
			</a>
		);
	return null;
}

type InlinePartData =
	| { type: "text"; value: string }
	| { type: "bold"; value: string }
	| { type: "italic"; value: string }
	| { type: "code"; value: string }
	| { type: "link"; value: string; href: string };

function parseInline(text: string): InlinePartData[] {
	const parts: InlinePartData[] = [];
	// Match: `code`, **bold**, *italic*, [text](url)
	const regex =
		/`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	match = regex.exec(text);
	while (match !== null) {
		if (match.index > lastIndex) {
			parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
		}

		if (match[1] != null) {
			parts.push({ type: "code", value: match[1] });
		} else if (match[2] != null) {
			parts.push({ type: "bold", value: match[2] });
		} else if (match[3] != null) {
			parts.push({ type: "italic", value: match[3] });
		} else if (match[4] != null && match[5] != null) {
			parts.push({ type: "link", value: match[4], href: match[5] });
		}

		lastIndex = match.index + match[0].length;
		match = regex.exec(text);
	}

	if (lastIndex < text.length) {
		parts.push({ type: "text", value: text.slice(lastIndex) });
	}

	return parts;
}
