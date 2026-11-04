// Ambient declaration so side-effect CSS imports (e.g. the Tailwind entry in
// preview.tsx) type-check. The @tailwindcss/vite plugin handles them at build
// time; TypeScript only needs to know the module resolves.
declare module "*.css";
