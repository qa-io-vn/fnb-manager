const NUMERIC_MIN_SIG_DIGITS = 16;
const DEC_DIGITS = 4;
const NUMERIC_MAX_DISPLAY_SCALE = 1000;
const FLOAT8_SIGNIFICANT_DIGITS = 15;

const powers: bigint[] = [];

function pow10(exponent: number): bigint {
	if (exponent < 0) {
		throw new RangeError(`negative power of ten ${exponent}`);
	}
	let cached = powers[exponent];
	if (cached === undefined) {
		cached = 10n ** BigInt(exponent);
		powers[exponent] = cached;
	}
	return cached;
}

function absolute(value: bigint): bigint {
	return value < 0n ? -value : value;
}

function divideRoundingHalfAway(
	numerator: bigint,
	denominator: bigint,
): bigint {
	const negative = numerator < 0n !== denominator < 0n;
	const top = absolute(numerator);
	const bottom = absolute(denominator);
	const quotient = top / bottom;
	const remainder = top % bottom;
	const rounded = remainder * 2n >= bottom ? quotient + 1n : quotient;
	return negative ? -rounded : rounded;
}

function integerSquareRoot(value: bigint): bigint {
	if (value < 0n) throw new RangeError("square root of a negative value");
	if (value < 2n) return value;
	let estimate = BigInt(Math.floor(Math.sqrt(Number(value))));
	if (estimate === 0n) estimate = 1n;
	for (;;) {
		const next = (estimate + value / estimate) / 2n;
		if (next >= estimate && next - estimate <= 1n) {
			let root = estimate;
			while (root * root > value) root -= 1n;
			while ((root + 1n) * (root + 1n) <= value) root += 1n;
			return root;
		}
		estimate = next;
	}
}

export class PgDecimal {
	readonly mantissa: bigint;
	readonly scale: number;

	private constructor(mantissa: bigint, scale: number) {
		if (!Number.isInteger(scale) || scale < 0) {
			throw new RangeError(
				`numeric scale must be a whole number >= 0, got ${scale}`,
			);
		}
		this.mantissa = mantissa;
		this.scale = scale;
	}

	static of(mantissa: bigint | number, scale = 0): PgDecimal {
		return new PgDecimal(
			typeof mantissa === "bigint" ? mantissa : BigInt(mantissa),
			scale,
		);
	}

	static integer(value: number | bigint): PgDecimal {
		if (typeof value === "number" && !Number.isSafeInteger(value)) {
			throw new RangeError(`expected a safe integer, got ${value}`);
		}
		return PgDecimal.of(value, 0);
	}

	static zero(scale = 0): PgDecimal {
		return new PgDecimal(0n, scale);
	}

	static parse(text: string): PgDecimal {
		const match = /^\s*([-+]?)(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?\s*$/.exec(
			text,
		);
		if (!match || `${match[2] ?? ""}${match[3] ?? ""}` === "") {
			throw new RangeError(`invalid input syntax for type numeric: "${text}"`);
		}
		const whole = match[2] ?? "";
		const fraction = match[3] ?? "";
		const exponent = Number(match[4] ?? "0");
		const digits = BigInt(`${whole}${fraction}` || "0");
		const signed = match[1] === "-" ? -digits : digits;
		const scale = fraction.length - exponent;
		if (scale >= 0) return new PgDecimal(signed, scale);
		return new PgDecimal(signed * pow10(-scale), 0);
	}

	static fromNumber(value: number, scale: number): PgDecimal {
		return PgDecimal.parse(value.toFixed(scale));
	}

	static sum(values: Iterable<PgDecimal>): PgDecimal | null {
		let total: PgDecimal | null = null;
		for (const value of values) {
			total = total === null ? value : total.add(value);
		}
		return total;
	}

	static avg(values: readonly PgDecimal[]): PgDecimal | null {
		const total = PgDecimal.sum(values);
		if (total === null) return null;
		return total.div(PgDecimal.integer(values.length));
	}

	private aligned(other: PgDecimal): [bigint, bigint, number] {
		const scale = Math.max(this.scale, other.scale);
		return [
			this.mantissa * pow10(scale - this.scale),
			other.mantissa * pow10(scale - other.scale),
			scale,
		];
	}

	add(other: PgDecimal): PgDecimal {
		const [left, right, scale] = this.aligned(other);
		return new PgDecimal(left + right, scale);
	}

	sub(other: PgDecimal): PgDecimal {
		const [left, right, scale] = this.aligned(other);
		return new PgDecimal(left - right, scale);
	}

	mul(other: PgDecimal): PgDecimal {
		return new PgDecimal(
			this.mantissa * other.mantissa,
			this.scale + other.scale,
		);
	}

	neg(): PgDecimal {
		return new PgDecimal(-this.mantissa, this.scale);
	}

	abs(): PgDecimal {
		return this.mantissa < 0n ? this.neg() : this;
	}

	sign(): -1 | 0 | 1 {
		return this.mantissa < 0n ? -1 : this.mantissa > 0n ? 1 : 0;
	}

	isZero(): boolean {
		return this.mantissa === 0n;
	}

	compare(other: PgDecimal): -1 | 0 | 1 {
		const [left, right] = this.aligned(other);
		return left < right ? -1 : left > right ? 1 : 0;
	}

	equals(other: PgDecimal): boolean {
		return this.compare(other) === 0;
	}

	divisionScale(other: PgDecimal): number {
		const [weight1, first1] = baseDigits(this);
		const [weight2, first2] = baseDigits(other);
		let quotientWeight = weight1 - weight2;
		if (first1 <= first2) quotientWeight -= 1;
		let rscale = NUMERIC_MIN_SIG_DIGITS - quotientWeight * DEC_DIGITS;
		rscale = Math.max(rscale, this.scale, other.scale, 0);
		return Math.min(rscale, NUMERIC_MAX_DISPLAY_SCALE);
	}

	div(other: PgDecimal): PgDecimal {
		if (other.isZero()) {
			throw new RangeError("division by zero");
		}
		const rscale = this.divisionScale(other);
		const numerator = this.mantissa * pow10(other.scale + rscale);
		const denominator = other.mantissa * pow10(this.scale);
		return new PgDecimal(
			divideRoundingHalfAway(numerator, denominator),
			rscale,
		);
	}

	divOrNull(other: PgDecimal | null): PgDecimal | null {
		if (other === null || other.isZero()) return null;
		return this.div(other);
	}

	round(digits = 0): PgDecimal {
		if (digits >= this.scale) {
			return new PgDecimal(
				this.mantissa * pow10(digits - this.scale),
				Math.max(digits, 0),
			);
		}
		const dropped = this.scale - digits;
		if (digits >= 0) {
			return new PgDecimal(
				divideRoundingHalfAway(this.mantissa, pow10(dropped)),
				digits,
			);
		}
		const units = divideRoundingHalfAway(this.mantissa, pow10(dropped));
		return new PgDecimal(units * pow10(-digits), 0);
	}

	sqrt(rscale: number): PgDecimal {
		if (this.mantissa < 0n) {
			throw new RangeError("cannot take square root of a negative number");
		}
		const extra = rscale + 1;
		const shift = 2 * extra - this.scale;
		const radicand =
			shift >= 0 ? this.mantissa * pow10(shift) : this.mantissa / pow10(-shift);
		const truncated = integerSquareRoot(radicand);
		return new PgDecimal(divideRoundingHalfAway(truncated, 10n), rscale);
	}

	toString(): string {
		const negative = this.mantissa < 0n;
		const digits = absolute(this.mantissa).toString();
		if (this.scale === 0) return `${negative ? "-" : ""}${digits}`;
		const padded = digits.padStart(this.scale + 1, "0");
		const whole = padded.slice(0, padded.length - this.scale);
		const fraction = padded.slice(padded.length - this.scale);
		return `${negative ? "-" : ""}${whole}.${fraction}`;
	}

	toNumber(): number {
		return Number(this.toString());
	}

	toFixedString(scale: number): string {
		return this.round(scale).toString();
	}
}

function baseDigits(value: PgDecimal): [number, number] {
	if (value.isZero()) return [0, 0];
	const magnitude = value.mantissa < 0n ? -value.mantissa : value.mantissa;
	const exponent = magnitude.toString().length - 1 - value.scale;
	const weight = Math.floor(exponent / DEC_DIGITS);
	const shift = value.scale + DEC_DIGITS * weight;
	const first =
		shift >= 0
			? Number(magnitude / pow10(shift))
			: Number(magnitude * pow10(-shift));
	return [weight, first];
}

export function decimal(value: PgDecimal | null): number | null {
	return value === null ? null : value.toNumber();
}

export function money(minorUnits: number): PgDecimal {
	return PgDecimal.of(minorUnits, 2);
}

export function quantity(thousandths: number): PgDecimal {
	return PgDecimal.of(thousandths, 3);
}

export function count(value: number): PgDecimal {
	return PgDecimal.integer(value);
}

export function roundedRatio(
	numerator: PgDecimal | null,
	denominator: PgDecimal | null,
	digits: number,
): number | null {
	if (numerator === null) return null;
	const quotient = numerator.divOrNull(denominator);
	return quotient === null ? null : quotient.round(digits).toNumber();
}

export function formatFloat8(value: number): string {
	if (!Number.isFinite(value)) {
		throw new RangeError(`cannot convert ${value} to numeric`);
	}
	const text = value.toPrecision(FLOAT8_SIGNIFICANT_DIGITS);
	const [mantissa = text, exponent] = text.split("e");
	const trimmed = mantissa.includes(".")
		? mantissa.replace(/0+$/, "").replace(/\.$/, "")
		: mantissa;
	return exponent === undefined ? trimmed : `${trimmed}e${exponent}`;
}

export function float8ToNumeric(value: number): PgDecimal {
	return PgDecimal.parse(formatFloat8(value));
}

export function numericToFloat8(value: PgDecimal): number {
	return Number(value.toString());
}

export function percentileContMedian(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const position = 0.5 * (sorted.length - 1);
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	const low = sorted[lower] as number;
	if (lower === upper) return low;
	const high = sorted[upper] as number;
	return low + (position - lower) * (high - low);
}

export function roundedMedian(
	values: readonly (PgDecimal | null)[],
	digits: number,
): number | null {
	const present = values
		.filter((value): value is PgDecimal => value !== null)
		.map(numericToFloat8);
	const median = percentileContMedian(present);
	if (median === null) return null;
	return float8ToNumeric(median).round(digits).toNumber();
}

export function stddevSample(values: readonly PgDecimal[]): PgDecimal | null {
	if (values.length <= 1) return null;
	let sum = PgDecimal.zero(0);
	let sumSquares = PgDecimal.zero(0);
	for (const value of values) {
		sum = sum.add(value);
		sumSquares = sumSquares.add(value.mul(value));
	}
	const n = PgDecimal.integer(values.length);
	const numerator = n.mul(sumSquares).sub(sum.mul(sum));
	if (numerator.sign() <= 0) return PgDecimal.zero(0);
	const denominator = n.mul(PgDecimal.integer(values.length - 1));
	const rscale = numerator.divisionScale(denominator);
	const variance = numerator.div(denominator);
	return variance.sqrt(rscale);
}
