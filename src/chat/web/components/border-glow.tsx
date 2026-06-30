import type * as React from "react";
import { type ReactNode, useEffect, useState } from "react";

// Adapted from ReactBits "Border Glow" (JS-CSS), reduced to just the colored
// mesh-gradient border: a cone of colour rides the card's 1px border and plays
// a one-off sweep on appear via `animated`. The original interior mesh fill,
// outer box-shadow bloom, and cursor-following hover behaviour are dropped — on
// a small input bar they flood the field; we only want the one-shot glowing
// border sweep. Tailwind utilities carry the SDK's `ww:` prefix so they compile
// in the chat widget's prefixed/shadow-DOM build.

interface BorderGlowProps {
	children?: ReactNode;
	className?: string;
	style?: React.CSSProperties;
	edgeSensitivity?: number;
	backgroundColor?: string;
	borderRadius?: number;
	coneSpread?: number;
	animated?: boolean;
	colors?: string[];
}

function easeOutCubic(x: number) {
	return 1 - (1 - x) ** 3;
}

interface AnimateOpts {
	start?: number;
	end?: number;
	duration?: number;
	delay?: number;
	ease?: (t: number) => number;
	onUpdate: (v: number) => void;
	onEnd?: () => void;
}

function animateValue({
	start = 0,
	end = 100,
	duration = 1000,
	delay = 0,
	ease = easeOutCubic,
	onUpdate,
	onEnd,
}: AnimateOpts) {
	const t0 = performance.now() + delay;
	function tick() {
		const elapsed = performance.now() - t0;
		const t = Math.min(elapsed / duration, 1);
		onUpdate(start + (end - start) * ease(t));
		if (t < 1) {
			requestAnimationFrame(tick);
		} else if (onEnd) {
			onEnd();
		}
	}
	setTimeout(() => requestAnimationFrame(tick), delay);
}

const GRADIENT_POSITIONS = [
	"80% 55%",
	"69% 34%",
	"8% 6%",
	"41% 38%",
	"86% 85%",
	"82% 18%",
	"51% 4%",
];
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];

function buildMeshGradients(colors: string[]): string[] {
	const gradients: string[] = [];
	for (let i = 0; i < 7; i++) {
		const c = colors[Math.min(COLOR_MAP[i], colors.length - 1)];
		gradients.push(
			`radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`,
		);
	}
	gradients.push(`linear-gradient(${colors[0]} 0 100%)`);
	return gradients;
}

const BorderGlow: React.FC<BorderGlowProps> = ({
	children,
	className = "",
	style,
	edgeSensitivity = 30,
	backgroundColor = "#120F17",
	borderRadius = 28,
	coneSpread = 25,
	animated = false,
	colors = ["#c084fc", "#f472b6", "#38bdf8"],
}) => {
	const [cursorAngle, setCursorAngle] = useState(110);
	const [edgeProximity, setEdgeProximity] = useState(0);
	const [sweepActive, setSweepActive] = useState(false);

	useEffect(() => {
		if (!animated) {
			return;
		}
		const angleStart = 110;
		setSweepActive(true);
		setCursorAngle(angleStart);

		// A single timeline drives the whole sweep so it reads as one motion:
		// the cone rotates one full turn at a constant speed (linear ease),
		// while the glow rides the same clock — a quick fade-in, a steady hold,
		// then a gentle fade-out. No separate intro phase, no mid-sweep speed
		// change.
		animateValue({
			ease: (t) => t,
			duration: 2000,
			onUpdate: (v) => {
				const t = v / 100;
				setCursorAngle(angleStart + 360 * t);
				const fadeIn = Math.min(t / 0.1, 1);
				const fadeOut = t > 0.85 ? (1 - t) / 0.15 : 1;
				setEdgeProximity(Math.min(fadeIn, fadeOut));
			},
			onEnd: () => setSweepActive(false),
		});
	}, [animated]);

	const colorSensitivity = edgeSensitivity + 20;
	const borderOpacity = sweepActive
		? Math.max(
				0,
				(edgeProximity * 100 - colorSensitivity) / (100 - colorSensitivity),
			)
		: 0;

	const meshGradients = buildMeshGradients(colors);
	const borderBg = meshGradients.map((g) => `${g} border-box`);
	const angleDeg = `${cursorAngle.toFixed(3)}deg`;
	const coneMask = `conic-gradient(from ${angleDeg} at center, black ${coneSpread}%, transparent ${coneSpread + 15}%, transparent ${100 - coneSpread - 15}%, black ${100 - coneSpread}%)`;

	return (
		<div
			className={`ww:relative ww:grid ww:isolate ww:border ${className}`}
			style={{
				background: backgroundColor,
				borderRadius: `${borderRadius}px`,
				transform: "translate3d(0, 0, 0.01px)",
				...style,
			}}
		>
			{/* colored mesh-gradient border */}
			<div
				className="ww:absolute ww:inset-0 ww:rounded-[inherit] ww:-z-[1]"
				style={{
					border: "1px solid transparent",
					background: [
						`linear-gradient(${backgroundColor} 0 100%) padding-box`,
						"linear-gradient(rgb(255 255 255 / 0%) 0% 100%) border-box",
						...borderBg,
					].join(", "),
					opacity: borderOpacity,
					maskImage: coneMask,
					WebkitMaskImage: coneMask,
					transition: sweepActive
						? "opacity 0.25s ease-out"
						: "opacity 0.75s ease-in-out",
				}}
			/>

			<div className="ww:flex ww:flex-col ww:relative ww:overflow-auto ww:z-[1]">
				{children}
			</div>
		</div>
	);
};

export default BorderGlow;
