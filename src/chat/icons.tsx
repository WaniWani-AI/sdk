import type React from "react";

const iconProps: React.SVGProps<SVGSVGElement> = {
	xmlns: "http://www.w3.org/2000/svg",
	fill: "none",
	viewBox: "0 0 24 24",
	strokeWidth: 1.5,
	stroke: "currentColor",
	"aria-hidden": "true",
	role: "img",
};

export function SendIcon(props: { size?: number }) {
	const size = props.size ?? 20;
	return (
		<svg {...iconProps} width={size} height={size}>
			<title>Send</title>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
			/>
		</svg>
	);
}

export function ToolIcon(props: { size?: number }) {
	const size = props.size ?? 14;
	return (
		<svg {...iconProps} width={size} height={size}>
			<title>Tool</title>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.048.58.024 1.194-.14 1.743"
			/>
		</svg>
	);
}
