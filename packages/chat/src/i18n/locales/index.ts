import type { Locale } from "../types";
import { en, type Messages } from "./en";
import { es } from "./es";
import { fr } from "./fr";

export type { Messages };

export const catalogs: Record<Locale, Messages> = {
	en,
	fr,
	es,
};
