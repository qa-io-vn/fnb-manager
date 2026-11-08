import { compareIsoDates, ISO_DATE_PATTERN, parseIsoDate } from "@fnb/core";
import { UsageError } from "../context.js";

export function isoDateOption(name: string, value: string): string {
	if (!ISO_DATE_PATTERN.test(value)) {
		throw new UsageError(`--${name} must be a date in the form YYYY-MM-DD`);
	}
	try {
		parseIsoDate(value);
	} catch {
		throw new UsageError(`--${name} is not a calendar date`);
	}
	return value;
}

export function windowOption(
	from: string,
	to: string,
): { fromDate: string; toDate: string } {
	const fromDate = isoDateOption("from", from);
	const toDate = isoDateOption("to", to);
	if (compareIsoDates(fromDate, toDate) > 0) {
		throw new UsageError("--from must not be after --to");
	}
	return { fromDate, toDate };
}
