import { DataPackError } from "./errors.js";

export const SIGNIFICANT_DIGITS = 15;

const PRECISION_TEXT = /^(-?)(\d+)(?:\.(\d+))?(?:e([-+]?\d+))?$/;

export function formatDecimal(value: number): string {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new DataPackError(
			"pack_invalid",
			`cannot write ${String(value)} as a decimal`,
		);
	}
	const match = PRECISION_TEXT.exec(value.toPrecision(SIGNIFICANT_DIGITS));
	if (!match) {
		throw new DataPackError(
			"pack_invalid",
			`cannot read ${String(value)} as a decimal`,
		);
	}
	const fraction = match[3] ?? "";
	let digits = BigInt(`${match[2]}${fraction}`);
	let scale = fraction.length - Number(match[4] ?? "0");
	if (digits === 0n) return "0";
	if (scale < 0) {
		digits *= 10n ** BigInt(-scale);
		scale = 0;
	}
	while (scale > 0 && digits % 10n === 0n) {
		digits /= 10n;
		scale -= 1;
	}
	const sign = match[1] === "-" ? "-" : "";
	const text = digits.toString();
	if (scale === 0) return `${sign}${text}`;
	const padded = text.padStart(scale + 1, "0");
	const point = padded.length - scale;
	return `${sign}${padded.slice(0, point)}.${padded.slice(point)}`;
}

export function decimalPlaces(value: number): number {
	const text = formatDecimal(value);
	const point = text.indexOf(".");
	return point === -1 ? 0 : text.length - point - 1;
}
