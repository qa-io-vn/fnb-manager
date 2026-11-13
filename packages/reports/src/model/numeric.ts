const SIGNIFICANT_DIGITS = 15;

interface DecimalParts {
	readonly negative: boolean;
	readonly digits: bigint;
	readonly scale: number;
}

function decimalParts(text: string): DecimalParts {
	const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([-+]?\d+))?$/i.exec(text);
	if (!match) {
		throw new RangeError(`cannot read "${text}" as a decimal`);
	}
	const fraction = match[3] ?? "";
	const exponent = Number(match[4] ?? "0");
	const digits = BigInt(`${match[2]}${fraction}`);
	const scale = fraction.length - exponent;
	if (scale < 0) {
		return {
			negative: match[1] === "-",
			digits: digits * 10n ** BigInt(-scale),
			scale: 0,
		};
	}
	return { negative: match[1] === "-", digits, scale };
}

function roundDigits(digits: bigint, scale: number, target: number): bigint {
	if (target >= scale) {
		return digits * 10n ** BigInt(target - scale);
	}
	const divisor = 10n ** BigInt(scale - target);
	const quotient = digits / divisor;
	const remainder = digits % divisor;
	return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

function partsToNumber(
	negative: boolean,
	magnitude: bigint,
	scale: number,
): number {
	if (magnitude === 0n) return 0;
	const text = magnitude.toString();
	if (scale <= 0) {
		const value = Number(`${text}${"0".repeat(-scale)}`);
		return negative ? -value : value;
	}
	const padded = text.padStart(scale + 1, "0");
	const value = Number(
		`${padded.slice(0, padded.length - scale)}.${padded.slice(padded.length - scale)}`,
	);
	return negative ? -value : value;
}

export function roundHalfAwayFromZero(value: number, digits: number): number {
	if (!Number.isFinite(value)) {
		throw new RangeError(`cannot round ${value}`);
	}
	if (!Number.isInteger(digits)) {
		throw new RangeError(`digits must be an integer, got ${digits}`);
	}
	const parts = decimalParts(value.toPrecision(SIGNIFICANT_DIGITS));
	const target = Math.max(digits, -SIGNIFICANT_DIGITS * 2);
	return partsToNumber(
		parts.negative,
		roundDigits(parts.digits, parts.scale, target),
		target,
	);
}

export function ratio(
	numerator: number | null | undefined,
	denominator: number | null | undefined,
	digits: number,
): number | null {
	if (
		numerator === null ||
		numerator === undefined ||
		denominator === null ||
		denominator === undefined ||
		denominator === 0
	) {
		return null;
	}
	return roundHalfAwayFromZero(numerator / denominator, digits);
}

export function relativeChange(
	current: number | null | undefined,
	reference: number | null | undefined,
): number | null {
	if (
		current === null ||
		current === undefined ||
		reference === null ||
		reference === undefined ||
		reference === 0
	) {
		return null;
	}
	return (current - reference) / reference;
}

function signedDigits(value: number): { digits: bigint; scale: number } {
	const parts = decimalParts(value.toPrecision(SIGNIFICANT_DIGITS));
	return {
		digits: parts.negative ? -parts.digits : parts.digits,
		scale: parts.scale,
	};
}

export function exactDifference(left: number, right: number): number {
	if (!Number.isFinite(left) || !Number.isFinite(right)) {
		throw new RangeError(`cannot subtract ${right} from ${left}`);
	}
	const one = signedDigits(left);
	const two = signedDigits(right);
	const scale = Math.max(one.scale, two.scale);
	const result =
		one.digits * 10n ** BigInt(scale - one.scale) -
		two.digits * 10n ** BigInt(scale - two.scale);
	return partsToNumber(result < 0n, result < 0n ? -result : result, scale);
}

export function difference(
	current: number | null | undefined,
	reference: number | null | undefined,
): number | null {
	if (
		current === null ||
		current === undefined ||
		reference === null ||
		reference === undefined
	) {
		return null;
	}
	return exactDifference(current, reference);
}

export function isPresent(value: number | null | undefined): value is number {
	return value !== null && value !== undefined && Number.isFinite(value);
}
