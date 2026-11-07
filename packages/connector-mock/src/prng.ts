export interface Rng {
	next(): number;
	int(min: number, max: number): number;
	chance(probability: number): boolean;
	pick<T>(values: readonly T[]): T;
	weightedIndex(weights: readonly number[]): number;
}

export function hashSeed(...parts: readonly (string | number)[]): number {
	let hash = 0x811c9dc5;
	for (const part of parts) {
		for (const char of `${part}|`) {
			hash ^= char.codePointAt(0) ?? 0;
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
	}
	return hash >>> 0;
}

export function mulberry32(seed: number): Rng {
	let state = seed >>> 0;

	const next = (): number => {
		state = (state + 0x6d2b79f5) >>> 0;
		let mixed = state;
		mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};

	return {
		next,
		int(min, max) {
			return min + Math.floor(next() * (max - min + 1));
		},
		chance(probability) {
			return next() < probability;
		},
		pick(values) {
			const value = values[Math.floor(next() * values.length)];
			if (value === undefined) {
				throw new RangeError("pick() needs a non-empty list");
			}
			return value;
		},
		weightedIndex(weights) {
			const total = weights.reduce((sum, weight) => sum + weight, 0);
			let remaining = next() * total;
			for (let index = 0; index < weights.length; index += 1) {
				remaining -= weights[index] ?? 0;
				if (remaining < 0) {
					return index;
				}
			}
			return weights.length - 1;
		},
	};
}
