export interface QrCode {
	readonly version: number;
	readonly size: number;
	readonly mask: number;
	readonly modules: readonly (readonly boolean[])[];
}

export class QrCapacityError extends Error {
	constructor() {
		super("the text is too long for a QR code");
		this.name = "QrCapacityError";
	}
}

export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 40;
export const QR_QUIET_ZONE = 4;

const MEDIUM_FORMAT_BITS = 0;

const ECC_CODEWORDS_PER_BLOCK: readonly number[] = [
	-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26,
	26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
	28, 28, 28,
];

const ERROR_CORRECTION_BLOCKS: readonly number[] = [
	-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17,
	18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function bitOf(value: number, index: number): boolean {
	return ((value >>> index) & 1) !== 0;
}

function rawDataModules(version: number): number {
	let modules = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const alignments = Math.floor(version / 7) + 2;
		modules -= (25 * alignments - 10) * alignments - 55;
		if (version >= 7) modules -= 36;
	}
	return modules;
}

function rawCodewords(version: number): number {
	return Math.floor(rawDataModules(version) / 8);
}

function dataCodewords(version: number): number {
	return (
		rawCodewords(version) -
		(ECC_CODEWORDS_PER_BLOCK[version] ?? 0) *
			(ERROR_CORRECTION_BLOCKS[version] ?? 0)
	);
}

function countBits(version: number): number {
	return version <= 9 ? 8 : 16;
}

function gfMultiply(x: number, y: number): number {
	let product = 0;
	for (let bit = 7; bit >= 0; bit--) {
		product = (product << 1) ^ ((product >>> 7) * 0x11d);
		product ^= ((y >>> bit) & 1) * x;
	}
	return product & 0xff;
}

function reedSolomonDivisor(degree: number): number[] {
	const divisor = new Array<number>(degree).fill(0);
	divisor[degree - 1] = 1;
	let root = 1;
	for (let step = 0; step < degree; step++) {
		for (let index = 0; index < divisor.length; index++) {
			divisor[index] = gfMultiply(divisor[index] ?? 0, root);
			if (index + 1 < divisor.length) {
				divisor[index] = (divisor[index] ?? 0) ^ (divisor[index + 1] ?? 0);
			}
		}
		root = gfMultiply(root, 0x02);
	}
	return divisor;
}

function reedSolomonRemainder(
	data: readonly number[],
	divisor: readonly number[],
): number[] {
	const remainder = divisor.map(() => 0);
	for (const byte of data) {
		const factor = byte ^ (remainder.shift() ?? 0);
		remainder.push(0);
		divisor.forEach((coefficient, index) => {
			remainder[index] =
				(remainder[index] ?? 0) ^ gfMultiply(coefficient, factor);
		});
	}
	return remainder;
}

function versionFor(byteCount: number): number {
	for (let version = QR_MIN_VERSION; version <= QR_MAX_VERSION; version++) {
		const needed = 4 + countBits(version) + byteCount * 8;
		if (
			byteCount < 2 ** countBits(version) &&
			needed <= dataCodewords(version) * 8
		) {
			return version;
		}
	}
	throw new QrCapacityError();
}

function dataCodewordsOf(bytes: Uint8Array, version: number): number[] {
	const bits: boolean[] = [];
	const append = (value: number, length: number) => {
		for (let index = length - 1; index >= 0; index--) {
			bits.push(bitOf(value, index));
		}
	};
	append(0b0100, 4);
	append(bytes.length, countBits(version));
	for (const byte of bytes) append(byte, 8);
	const capacity = dataCodewords(version) * 8;
	append(0, Math.min(4, capacity - bits.length));
	append(0, (8 - (bits.length % 8)) % 8);
	const codewords: number[] = [];
	for (let index = 0; index < bits.length; index += 8) {
		let byte = 0;
		for (let offset = 0; offset < 8; offset++) {
			byte = (byte << 1) | (bits[index + offset] ? 1 : 0);
		}
		codewords.push(byte);
	}
	for (let pad = 0xec; codewords.length < capacity / 8; pad ^= 0xec ^ 0x11) {
		codewords.push(pad);
	}
	return codewords;
}

function withErrorCorrection(data: readonly number[], version: number) {
	const blockCount = ERROR_CORRECTION_BLOCKS[version] ?? 1;
	const eccLength = ECC_CODEWORDS_PER_BLOCK[version] ?? 0;
	const total = rawCodewords(version);
	const shortBlocks = blockCount - (total % blockCount);
	const shortLength = Math.floor(total / blockCount);
	const divisor = reedSolomonDivisor(eccLength);
	const blocks: number[][] = [];
	for (let block = 0, offset = 0; block < blockCount; block++) {
		const length = shortLength - eccLength + (block < shortBlocks ? 0 : 1);
		const part = data.slice(offset, offset + length);
		offset += length;
		const ecc = reedSolomonRemainder(part, divisor);
		if (block < shortBlocks) part.push(0);
		blocks.push([...part, ...ecc]);
	}
	const interleaved: number[] = [];
	const width = blocks[0]?.length ?? 0;
	for (let column = 0; column < width; column++) {
		blocks.forEach((block, index) => {
			if (column !== shortLength - eccLength || index >= shortBlocks) {
				interleaved.push(block[column] ?? 0);
			}
		});
	}
	return interleaved;
}

function alignmentPositions(version: number, size: number): number[] {
	if (version === 1) return [];
	const count = Math.floor(version / 7) + 2;
	const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
	const positions = [6];
	for (let position = size - 7; positions.length < count; position -= step) {
		positions.splice(1, 0, position);
	}
	return positions;
}

class Grid {
	readonly size: number;
	readonly dark: boolean[][];
	readonly reserved: boolean[][];

	constructor(size: number) {
		this.size = size;
		this.dark = Array.from({ length: size }, () =>
			new Array<boolean>(size).fill(false),
		);
		this.reserved = Array.from({ length: size }, () =>
			new Array<boolean>(size).fill(false),
		);
	}

	set(x: number, y: number, dark: boolean) {
		const row = this.dark[y];
		const reserved = this.reserved[y];
		if (row === undefined || reserved === undefined) return;
		row[x] = dark;
		reserved[x] = true;
	}

	isDark(x: number, y: number): boolean {
		return this.dark[y]?.[x] === true;
	}

	isReserved(x: number, y: number): boolean {
		return this.reserved[y]?.[x] === true;
	}

	flip(x: number, y: number) {
		const row = this.dark[y];
		if (row !== undefined) row[x] = !row[x];
	}
}

function drawFinder(grid: Grid, x: number, y: number) {
	for (let dy = -4; dy <= 4; dy++) {
		for (let dx = -4; dx <= 4; dx++) {
			const distance = Math.max(Math.abs(dx), Math.abs(dy));
			const column = x + dx;
			const row = y + dy;
			if (column >= 0 && column < grid.size && row >= 0 && row < grid.size) {
				grid.set(column, row, distance !== 2 && distance !== 4);
			}
		}
	}
}

function drawAlignment(grid: Grid, x: number, y: number) {
	for (let dy = -2; dy <= 2; dy++) {
		for (let dx = -2; dx <= 2; dx++) {
			grid.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
		}
	}
}

function drawFormatBits(grid: Grid, mask: number) {
	const data = (MEDIUM_FORMAT_BITS << 3) | mask;
	let remainder = data;
	for (let step = 0; step < 10; step++) {
		remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
	}
	const bits = ((data << 10) | remainder) ^ 0x5412;
	const size = grid.size;
	for (let index = 0; index <= 5; index++)
		grid.set(8, index, bitOf(bits, index));
	grid.set(8, 7, bitOf(bits, 6));
	grid.set(8, 8, bitOf(bits, 7));
	grid.set(7, 8, bitOf(bits, 8));
	for (let index = 9; index < 15; index++) {
		grid.set(14 - index, 8, bitOf(bits, index));
	}
	for (let index = 0; index < 8; index++) {
		grid.set(size - 1 - index, 8, bitOf(bits, index));
	}
	for (let index = 8; index < 15; index++) {
		grid.set(8, size - 15 + index, bitOf(bits, index));
	}
	grid.set(8, size - 8, true);
}

function drawVersionBits(grid: Grid, version: number) {
	if (version < 7) return;
	let remainder = version;
	for (let step = 0; step < 12; step++) {
		remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
	}
	const bits = (version << 12) | remainder;
	for (let index = 0; index < 18; index++) {
		const dark = bitOf(bits, index);
		const across = grid.size - 11 + (index % 3);
		const down = Math.floor(index / 3);
		grid.set(across, down, dark);
		grid.set(down, across, dark);
	}
}

function drawFunctionPatterns(grid: Grid, version: number) {
	const size = grid.size;
	for (let index = 0; index < size; index++) {
		grid.set(6, index, index % 2 === 0);
		grid.set(index, 6, index % 2 === 0);
	}
	drawFinder(grid, 3, 3);
	drawFinder(grid, size - 4, 3);
	drawFinder(grid, 3, size - 4);
	const positions = alignmentPositions(version, size);
	const last = positions.length - 1;
	positions.forEach((across, i) => {
		positions.forEach((down, j) => {
			const nearFinder =
				(i === 0 && j === 0) ||
				(i === 0 && j === last) ||
				(i === last && j === 0);
			if (!nearFinder) drawAlignment(grid, across, down);
		});
	});
	drawFormatBits(grid, 0);
	drawVersionBits(grid, version);
}

function drawCodewords(grid: Grid, codewords: readonly number[]) {
	const size = grid.size;
	let bit = 0;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let step = 0; step < size; step++) {
			for (let offset = 0; offset < 2; offset++) {
				const x = right - offset;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? size - 1 - step : step;
				if (grid.isReserved(x, y) || bit >= codewords.length * 8) continue;
				const row = grid.dark[y];
				if (row !== undefined) {
					row[x] = bitOf(codewords[bit >>> 3] ?? 0, 7 - (bit & 7));
				}
				bit++;
			}
		}
	}
}

function masked(mask: number, x: number, y: number): boolean {
	switch (mask) {
		case 0:
			return (x + y) % 2 === 0;
		case 1:
			return y % 2 === 0;
		case 2:
			return x % 3 === 0;
		case 3:
			return (x + y) % 3 === 0;
		case 4:
			return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
		case 5:
			return ((x * y) % 2) + ((x * y) % 3) === 0;
		case 6:
			return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
		default:
			return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
	}
}

function applyMask(grid: Grid, mask: number) {
	for (let y = 0; y < grid.size; y++) {
		for (let x = 0; x < grid.size; x++) {
			if (!grid.isReserved(x, y) && masked(mask, x, y)) grid.flip(x, y);
		}
	}
}

function finderLikeRuns(history: readonly number[]): number {
	const [before = 0, n = 0, second = 0, core = 0, fourth = 0, fifth = 0] =
		history;
	const after = history[6] ?? 0;
	const centre =
		n > 0 && second === n && core === n * 3 && fourth === n && fifth === n;
	return (
		(centre && before >= n * 4 && after >= n ? 1 : 0) +
		(centre && after >= n * 4 && before >= n ? 1 : 0)
	);
}

function lineScore(line: readonly boolean[], size: number): number {
	let score = 0;
	let runDark = false;
	let runLength = 0;
	const history = [0, 0, 0, 0, 0, 0, 0];
	const remember = (length: number) => {
		const value = history[0] === 0 ? length + size : length;
		history.pop();
		history.unshift(value);
	};
	for (const dark of line) {
		if (dark === runDark) {
			runLength++;
			if (runLength === 5) score += PENALTY_N1;
			else if (runLength > 5) score++;
			continue;
		}
		remember(runLength);
		if (!runDark) score += finderLikeRuns(history) * PENALTY_N3;
		runDark = dark;
		runLength = 1;
	}
	if (runDark) {
		remember(runLength);
		runLength = 0;
	}
	remember(runLength + size);
	return score + finderLikeRuns(history) * PENALTY_N3;
}

function penaltyOf(grid: Grid): number {
	const size = grid.size;
	let score = 0;
	for (let y = 0; y < size; y++) {
		score += lineScore(grid.dark[y] ?? [], size);
	}
	for (let x = 0; x < size; x++) {
		score += lineScore(
			grid.dark.map((row) => row[x] === true),
			size,
		);
	}
	for (let y = 0; y < size - 1; y++) {
		for (let x = 0; x < size - 1; x++) {
			const dark = grid.isDark(x, y);
			if (
				dark === grid.isDark(x + 1, y) &&
				dark === grid.isDark(x, y + 1) &&
				dark === grid.isDark(x + 1, y + 1)
			) {
				score += PENALTY_N2;
			}
		}
	}
	const darkCount = grid.dark.reduce(
		(count, row) => count + row.filter(Boolean).length,
		0,
	);
	const total = size * size;
	const deviation =
		Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1;
	return score + deviation * PENALTY_N4;
}

function gridFor(version: number, codewords: readonly number[], mask: number) {
	const grid = new Grid(version * 4 + 17);
	drawFunctionPatterns(grid, version);
	drawCodewords(grid, codewords);
	applyMask(grid, mask);
	drawFormatBits(grid, mask);
	return grid;
}

export function encodeQr(
	text: string,
	options: { readonly mask?: number } = {},
): QrCode {
	const bytes = new TextEncoder().encode(text);
	const version = versionFor(bytes.length);
	const codewords = withErrorCorrection(
		dataCodewordsOf(bytes, version),
		version,
	);
	const masks =
		options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];
	let best: { grid: Grid; mask: number; penalty: number } | null = null;
	for (const mask of masks) {
		const grid = gridFor(version, codewords, mask);
		const penalty = masks.length === 1 ? 0 : penaltyOf(grid);
		if (best === null || penalty < best.penalty) best = { grid, mask, penalty };
	}
	if (best === null) throw new QrCapacityError();
	return {
		version,
		size: best.grid.size,
		mask: best.mask,
		modules: best.grid.dark,
	};
}

export function qrPathOf(code: QrCode, quietZone = QR_QUIET_ZONE): string {
	const parts: string[] = [];
	code.modules.forEach((row, y) => {
		let x = 0;
		while (x < row.length) {
			if (!row[x]) {
				x++;
				continue;
			}
			let end = x;
			while (row[end]) end++;
			parts.push(`M${x + quietZone} ${y + quietZone}h${end - x}v1h${x - end}z`);
			x = end;
		}
	});
	return parts.join("");
}
