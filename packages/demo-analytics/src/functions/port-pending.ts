import { ThemeCallError, type ThemeFunctionName } from "@fnb/reports";
import type { ThemeHandler } from "./theme-support.js";

export const NOT_IMPLEMENTED_CODE = "not_implemented";

export const PORT_PENDING_FUNCTIONS = [
	"data_quality_items",
	"data_quality_summary",
	"data_quality_payments",
] as const satisfies readonly ThemeFunctionName[];

export type PortPendingFunction = (typeof PORT_PENDING_FUNCTIONS)[number];

export function portPending<N extends PortPendingFunction>(
	name: N,
): ThemeHandler<N> {
	return () => {
		throw new ThemeCallError(
			name,
			NOT_IMPLEMENTED_CODE,
			"the demo has no port of this function yet",
		);
	};
}
