import type { DateRange } from "../contract/values.js";
import type { CardMarkers } from "../model/card.js";
import type { CoverageModel } from "../model/coverage.js";
import {
	part,
	partValue,
	type TypedValue,
	textValue,
} from "../model/values.js";
import { catchUpOverlaps, type ThemeContext } from "./context.js";
import { themeKeys } from "./keys.js";

export function spanValue(span: DateRange): TypedValue {
	return partValue(
		part(themeKeys.range.span, {
			from: textValue("date", span.from),
			to: textValue("date", span.to),
		}),
	);
}

export function rangeValue(context: Pick<ThemeContext, "range">): TypedValue {
	return spanValue(context.range);
}

export function themeMarkers(
	input: { readonly context: ThemeContext; readonly coverage: CoverageModel },
	readsAggregates: boolean,
): CardMarkers {
	return {
		provisional: false,
		stale:
			readsAggregates &&
			(input.coverage.staleStoreIds.length > 0 ||
				catchUpOverlaps(input.context)),
		verification: input.coverage.verification,
	};
}
