import type { RegisteredResource } from "../../resources/types";
import type {
	BooleanField,
	NumberField,
	SelectField,
	TextField,
	WidgetField,
} from "./@types";

/**
 * Field definition helpers for dynamic flows.
 *
 * @example
 * ```ts
 * import { field } from "@waniwani/sdk/mcp";
 *
 * const fields = {
 *   name: field.text({ label: "Full name" }),
 *   plan: field.select({ label: "Plan", options: ["starter", "pro", "enterprise"] }),
 *   seats: field.number({ label: "Number of seats", min: 1 }),
 *   agreed: field.boolean({ label: "Agrees to terms" }),
 * };
 * ```
 */
export const field = {
	text: (config: Omit<TextField, "type">): TextField => ({
		type: "text",
		...config,
	}),

	select: (config: Omit<SelectField, "type">): SelectField => ({
		type: "select",
		...config,
	}),

	number: (config: Omit<NumberField, "type">): NumberField => ({
		type: "number",
		...config,
	}),

	boolean: (config: Omit<BooleanField, "type">): BooleanField => ({
		type: "boolean",
		...config,
	}),

	widget: (
		resource: RegisteredResource,
		config: Omit<WidgetField, "type" | "resource">,
	): WidgetField => ({
		type: "widget",
		resource,
		...config,
	}),
};
