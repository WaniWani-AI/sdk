export const LAYOUTS = ["bar", "card"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const MODES = ["dark", "light"] as const;
export type Mode = (typeof MODES)[number];
