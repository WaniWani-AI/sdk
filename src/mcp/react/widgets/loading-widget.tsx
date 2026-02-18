export const LoadingWidget = () => {
	return (
		<div className="flex flex-col items-center justify-center h-full min-h-[120px] gap-4">
			{/* Animated dots */}
			<div className="flex gap-2">
				<div className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-400 to-cyan-400 animate-bounce [animation-delay:-0.3s]" />
				<div className="w-3 h-3 rounded-full bg-gradient-to-r from-cyan-400 to-teal-400 animate-bounce [animation-delay:-0.15s]" />
				<div className="w-3 h-3 rounded-full bg-gradient-to-r from-teal-400 to-emerald-400 animate-bounce" />
			</div>

			{/* Shimmer text */}
			<p className="text-sm font-medium text-transparent bg-clip-text bg-gradient-to-r from-slate-400 via-slate-200 to-slate-400 bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]">
				Loading widget...
			</p>

			{/* Pulsing ring */}
			<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
				<div className="w-16 h-16 rounded-full border-2 border-blue-400/20 animate-ping" />
			</div>

			<style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
		</div>
	);
};
