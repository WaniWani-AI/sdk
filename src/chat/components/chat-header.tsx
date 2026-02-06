interface ChatHeaderProps {
	title: string;
	subtitle?: string;
}

export function ChatHeader(props: ChatHeaderProps) {
	const { title, subtitle } = props;

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				padding: "14px 16px",
				borderBottom: "1px solid var(--ww-border)",
				backgroundColor: "var(--ww-primary)",
				color: "var(--ww-primary-fg)",
				borderRadius: "var(--ww-radius) var(--ww-radius) 0 0",
			}}
		>
			<div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
				<span style={{ fontWeight: 600, fontSize: "15px" }}>{title}</span>
				{subtitle && (
					<span style={{ fontSize: "12px", opacity: 0.85 }}>{subtitle}</span>
				)}
			</div>
		</div>
	);
}
