import { inflateSync } from "node:zlib";

export const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
export const LOGO_MIN_SIDE = 256;
const CORNER_TOLERANCE = 8;
const CHANNELS: Readonly<Record<number, number>> = {
	0: 1,
	2: 3,
	3: 1,
	4: 2,
	6: 4,
};

export interface DecodedPng {
	readonly width: number;
	readonly height: number;
	pixel(x: number, y: number): readonly [number, number, number, number];
}

export class PngError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PngError";
	}
}

function paeth(left: number, up: number, upLeft: number): number {
	const estimate = left + up - upLeft;
	const toLeft = Math.abs(estimate - left);
	const toUp = Math.abs(estimate - up);
	const toUpLeft = Math.abs(estimate - upLeft);
	if (toLeft <= toUp && toLeft <= toUpLeft) return left;
	return toUp <= toUpLeft ? up : upLeft;
}

function unfilter(
	raw: Uint8Array,
	height: number,
	rowBytes: number,
	pixelBytes: number,
): Uint8Array {
	const out = new Uint8Array(height * rowBytes);
	for (let y = 0; y < height; y += 1) {
		const filter = raw[y * (rowBytes + 1)];
		const source = y * (rowBytes + 1) + 1;
		const row = y * rowBytes;
		for (let x = 0; x < rowBytes; x += 1) {
			const value = raw[source + x] ?? 0;
			const left = x >= pixelBytes ? (out[row + x - pixelBytes] ?? 0) : 0;
			const up = y > 0 ? (out[row - rowBytes + x] ?? 0) : 0;
			const upLeft =
				y > 0 && x >= pixelBytes
					? (out[row - rowBytes + x - pixelBytes] ?? 0)
					: 0;
			let decoded: number;
			switch (filter) {
				case 0:
					decoded = value;
					break;
				case 1:
					decoded = value + left;
					break;
				case 2:
					decoded = value + up;
					break;
				case 3:
					decoded = value + Math.floor((left + up) / 2);
					break;
				case 4:
					decoded = value + paeth(left, up, upLeft);
					break;
				default:
					throw new PngError(`the PNG has an unknown row filter ${filter}`);
			}
			out[row + x] = decoded & 0xff;
		}
	}
	return out;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
	if (
		bytes.length < 8 ||
		!PNG_SIGNATURE.every((value, index) => bytes[index] === value)
	) {
		throw new PngError("the logo is not a PNG file");
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = -1;
	let interlace = 0;
	let palette: Uint8Array | null = null;
	let transparency: Uint8Array | null = null;
	const data: Uint8Array[] = [];
	while (offset + 8 <= bytes.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		const body = bytes.subarray(offset + 8, offset + 8 + length);
		if (body.length !== length) throw new PngError("the PNG is cut short");
		if (type === "IHDR") {
			width = view.getUint32(offset + 8);
			height = view.getUint32(offset + 12);
			bitDepth = body[8] ?? 0;
			colorType = body[9] ?? -1;
			interlace = body[12] ?? 0;
		} else if (type === "PLTE") {
			palette = body;
		} else if (type === "tRNS") {
			transparency = body;
		} else if (type === "IDAT") {
			data.push(body);
		} else if (type === "IEND") {
			break;
		}
		offset += 12 + length;
	}
	const channels = CHANNELS[colorType];
	if (width === 0 || height === 0 || channels === undefined) {
		throw new PngError("the PNG has no readable header");
	}
	if (interlace !== 0) {
		throw new PngError(
			"the PNG is interlaced; save it without interlacing to check it",
		);
	}
	if (colorType === 3 && palette === null) {
		throw new PngError("the PNG has no palette");
	}
	const bitsPerPixel = channels * bitDepth;
	const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
	const pixelBytes = Math.max(1, bitsPerPixel / 8);
	let pixels: Uint8Array;
	try {
		pixels = unfilter(
			new Uint8Array(inflateSync(Buffer.concat(data))),
			height,
			rowBytes,
			pixelBytes,
		);
	} catch (error) {
		if (error instanceof PngError) throw error;
		throw new PngError("the PNG's image data cannot be read");
	}
	const maxSample = 2 ** bitDepth - 1;
	const sample = (x: number, y: number, channel: number): number => {
		const row = y * rowBytes;
		if (bitDepth === 16) {
			const at = row + (x * channels + channel) * 2;
			return ((pixels[at] ?? 0) << 8) | (pixels[at + 1] ?? 0);
		}
		if (bitDepth === 8) return pixels[row + x * channels + channel] ?? 0;
		const bit = (x * channels + channel) * bitDepth;
		const byte = pixels[row + (bit >> 3)] ?? 0;
		return (byte >> (8 - bitDepth - (bit & 7))) & maxSample;
	};
	const to8 = (value: number): number => Math.round((value * 255) / maxSample);
	const transparentKey = (values: readonly number[]): boolean => {
		if (transparency === null) return false;
		const keyView = new DataView(
			transparency.buffer,
			transparency.byteOffset,
			transparency.byteLength,
		);
		return values.every(
			(value, index) =>
				index * 2 + 1 < transparency.length &&
				keyView.getUint16(index * 2) === value,
		);
	};
	return {
		width,
		height,
		pixel(x, y) {
			switch (colorType) {
				case 0: {
					const gray = sample(x, y, 0);
					const value = to8(gray);
					return [value, value, value, transparentKey([gray]) ? 0 : 255];
				}
				case 2: {
					const values = [0, 1, 2].map((channel) => sample(x, y, channel));
					const [red = 0, green = 0, blue = 0] = values.map(to8);
					return [red, green, blue, transparentKey(values) ? 0 : 255];
				}
				case 3: {
					const index = sample(x, y, 0);
					return [
						palette?.[index * 3] ?? 0,
						palette?.[index * 3 + 1] ?? 0,
						palette?.[index * 3 + 2] ?? 0,
						transparency?.[index] ?? 255,
					];
				}
				case 4: {
					const value = to8(sample(x, y, 0));
					return [value, value, value, to8(sample(x, y, 1))];
				}
				default: {
					const [red = 0, green = 0, blue = 0, alpha = 0] = [0, 1, 2, 3].map(
						(channel) => to8(sample(x, y, channel)),
					);
					return [red, green, blue, alpha];
				}
			}
		},
	};
}

function close(
	first: readonly number[],
	second: readonly number[],
	tolerance: number,
): boolean {
	return first.every(
		(value, index) => Math.abs(value - (second[index] ?? 0)) <= tolerance,
	);
}

export interface LogoCheck {
	readonly problems: string[];
	readonly notes: string[];
}

export function logoProblems(bytes: Uint8Array): LogoCheck {
	let image: DecodedPng;
	try {
		image = decodePng(bytes);
	} catch (error) {
		if (error instanceof PngError)
			return { problems: [error.message], notes: [] };
		throw error;
	}
	const problems: string[] = [];
	const notes: string[] = [];
	if (image.width !== image.height) {
		problems.push(
			`the logo must be square; it is ${image.width} × ${image.height} px`,
		);
	}
	if (Math.min(image.width, image.height) < LOGO_MIN_SIDE) {
		notes.push(
			`the logo is ${image.width} × ${image.height} px; ${LOGO_MIN_SIDE} × ${LOGO_MIN_SIDE} px or larger keeps it sharp`,
		);
	}
	let transparent = 0;
	for (let y = 0; y < image.height; y += 1) {
		for (let x = 0; x < image.width; x += 1) {
			if (image.pixel(x, y)[3] < 255) transparent += 1;
		}
	}
	if (transparent > 0) {
		problems.push(
			`the logo has ${transparent} transparent or see-through pixels; Zalo refuses a transparent background`,
		);
	}
	const corners = [
		image.pixel(0, 0),
		image.pixel(image.width - 1, 0),
		image.pixel(0, image.height - 1),
		image.pixel(image.width - 1, image.height - 1),
	];
	const [first] = corners;
	if (
		first !== undefined &&
		!corners.every((corner) => close(corner, first, CORNER_TOLERANCE))
	) {
		problems.push(
			"the logo's corners differ; it needs one solid background colour",
		);
	}
	return { problems, notes };
}
