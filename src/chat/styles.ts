export function buildStyleSheet(): string {
	return `
/* WaniWani Chat Widget Reset & Styles */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

@keyframes ww-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes ww-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}

@keyframes ww-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

/* Scrollbar */
.ww-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.ww-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.ww-scrollbar::-webkit-scrollbar-thumb {
  background: var(--ww-border);
  border-radius: 4px;
}
.ww-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--ww-muted);
}
`.trim();
}
