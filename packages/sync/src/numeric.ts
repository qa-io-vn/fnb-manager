import { roundMoney } from "@fnb/core";

export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 3;

export function formatNumeric(value: number, scale: number): string {
	if (!Number.isFinite(value)) {
		throw new RangeError(`cannot store a non-finite number (${value})`);
	}
	const text = roundMoney(value, scale).toFixed(scale);
	return Number(text) === 0 ? (0).toFixed(scale) : text;
}

export function formatMoney(value: number): string {
	return formatNumeric(value, MONEY_SCALE);
}

export function formatOptionalMoney(value: number | undefined): string | null {
	return value === undefined ? null : formatMoney(value);
}

export function formatQuantity(value: number): string {
	return formatNumeric(value, QUANTITY_SCALE);
}

export function parseNumeric(text: string): number {
	const value = Number(text);
	if (!Number.isFinite(value)) {
		throw new RangeError(`"${text}" is not a number`);
	}
	return value;
}
