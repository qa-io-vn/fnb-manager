import { WEEKDAY_KEYS } from "../calendar.js";

const CLOCK = /^[0-9]{1,2}:[0-9]{2}$/;

function isClock(value: unknown): boolean {
	return typeof value === "string" && CLOCK.test(value);
}

export function openingHoursPresent(value: unknown): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const days = value as Readonly<Record<string, unknown>>;
	return WEEKDAY_KEYS.some((key) => {
		const spans = days[key];
		return (
			Array.isArray(spans) &&
			spans.some(
				(span) => Array.isArray(span) && isClock(span[0]) && isClock(span[1]),
			)
		);
	});
}
