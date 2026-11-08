const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export function fnv1a64(text: string): bigint {
	let hash = FNV_OFFSET_BASIS;
	for (const byte of new TextEncoder().encode(text)) {
		hash ^= BigInt(byte);
		hash = (hash * FNV_PRIME) & UINT64_MASK;
	}
	return hash;
}

export function fastHash(text: string): string {
	let first = 0xdeadbeef;
	let second = 0x41c6ce57;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		first = Math.imul(first ^ code, 2654435761);
		second = Math.imul(second ^ code, 1597334677);
	}
	first =
		Math.imul(first ^ (first >>> 16), 2246822507) ^
		Math.imul(second ^ (second >>> 13), 3266489909);
	second =
		Math.imul(second ^ (second >>> 16), 2246822507) ^
		Math.imul(first ^ (first >>> 13), 3266489909);
	const high = (second >>> 0).toString(16).padStart(8, "0");
	const low = (first >>> 0).toString(16).padStart(8, "0");
	return `${high}${low}`;
}
