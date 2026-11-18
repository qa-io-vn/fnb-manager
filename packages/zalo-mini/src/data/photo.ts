export const PHOTO_MAX_LONG_SIDE = 1280;
export const PHOTO_MAX_BYTES = 1_000_000;
export const PHOTO_TYPE = "image/jpeg";
export const PHOTO_QUALITIES: readonly number[] = [
	0.85, 0.75, 0.65, 0.55, 0.45,
];
export const PHOTO_SHRINK = 0.75;
export const PHOTO_SHRINK_STEPS = 4;
const EXIF_SCAN_BYTES = 256 * 1024;
const ORIENTATION_TAG = 0x0112;

export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface PhotoSize {
	readonly width: number;
	readonly height: number;
}

export type Matrix = readonly [number, number, number, number, number, number];

export interface PhotoCanvas {
	encode(quality: number): Promise<Blob>;
	release(): void;
}

export interface DecodedPhoto extends PhotoSize {
	draw(output: PhotoSize, drawn: PhotoSize, matrix: Matrix): PhotoCanvas;
	close(): void;
}

export interface PhotoCodec {
	decode(photo: Blob): Promise<DecodedPhoto>;
	appliesOrientation(): Promise<boolean>;
}

export interface PhotoLimits {
	readonly maxLongSide: number;
	readonly maxBytes: number;
}

export interface ResizedPhoto extends PhotoSize {
	readonly blob: Blob;
	readonly quality: number;
}

export class PhotoError extends Error {
	readonly reason: "unreadable" | "too-large";

	constructor(reason: "unreadable" | "too-large") {
		super(
			reason === "unreadable"
				? "the photo could not be read"
				: "the photo stays over the size limit",
		);
		this.name = "PhotoError";
		this.reason = reason;
	}
}

function isOrientation(value: number): value is Orientation {
	return Number.isInteger(value) && value >= 1 && value <= 8;
}

export function jpegOrientation(bytes: Uint8Array): Orientation {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) return 1;
		const marker = bytes[offset + 1] ?? 0;
		if (marker === 0xda || marker === 0xd9) return 1;
		const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
		if (length < 2) return 1;
		if (marker === 0xe1) {
			const found = exifOrientation(bytes, offset + 4, offset + 2 + length);
			if (found !== null) return found;
		}
		offset += 2 + length;
	}
	return 1;
}

function exifOrientation(
	bytes: Uint8Array,
	start: number,
	end: number,
): Orientation | null {
	const header = [0x45, 0x78, 0x69, 0x66, 0, 0];
	if (end > bytes.length || header.some((byte, i) => bytes[start + i] !== byte))
		return null;
	const tiff = start + 6;
	const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
	const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
	if (!little && !big) return null;
	const short = (at: number) =>
		little
			? (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)
			: ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
	const long = (at: number) =>
		little
			? (short(at) | (short(at + 2) << 16)) >>> 0
			: ((short(at) << 16) | short(at + 2)) >>> 0;
	if (short(tiff + 2) !== 0x2a) return null;
	const ifd = tiff + long(tiff + 4);
	if (ifd + 2 > end) return null;
	const entries = short(ifd);
	for (let i = 0; i < entries; i += 1) {
		const entry = ifd + 2 + i * 12;
		if (entry + 12 > end) return null;
		if (short(entry) === ORIENTATION_TAG) {
			const value = short(entry + 8);
			return isOrientation(value) ? value : null;
		}
	}
	return null;
}

export function withOrientation(
	bytes: Uint8Array,
	orientation: Orientation,
): Uint8Array {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
		throw new Error("not a JPEG file");
	const segment = Uint8Array.from([
		0xff,
		0xe1,
		0x00,
		0x22,
		0x45,
		0x78,
		0x69,
		0x66,
		0x00,
		0x00,
		0x4d,
		0x4d,
		0x00,
		0x2a,
		0x00,
		0x00,
		0x00,
		0x08,
		0x00,
		0x01,
		0x01,
		0x12,
		0x00,
		0x03,
		0x00,
		0x00,
		0x00,
		0x01,
		0x00,
		orientation,
		0x00,
		0x00,
		0x00,
		0x00,
		0x00,
		0x00,
	]);
	const output = new Uint8Array(bytes.length + segment.length);
	output.set(bytes.subarray(0, 2), 0);
	output.set(segment, 2);
	output.set(bytes.subarray(2), 2 + segment.length);
	return output;
}

export function orientedSize(
	size: PhotoSize,
	orientation: Orientation,
): PhotoSize {
	return orientation >= 5
		? { width: size.height, height: size.width }
		: { width: size.width, height: size.height };
}

export function fittedSize(size: PhotoSize, maxLongSide: number): PhotoSize {
	const longSide = Math.max(size.width, size.height);
	if (longSide <= maxLongSide)
		return {
			width: Math.max(1, Math.round(size.width)),
			height: Math.max(1, Math.round(size.height)),
		};
	const scale = maxLongSide / longSide;
	return {
		width: Math.max(1, Math.round(size.width * scale)),
		height: Math.max(1, Math.round(size.height * scale)),
	};
}

export function orientationMatrix(
	orientation: Orientation,
	drawn: PhotoSize,
): Matrix {
	const { width, height } = drawn;
	switch (orientation) {
		case 2:
			return [-1, 0, 0, 1, width, 0];
		case 3:
			return [-1, 0, 0, -1, width, height];
		case 4:
			return [1, 0, 0, -1, 0, height];
		case 5:
			return [0, 1, 1, 0, 0, 0];
		case 6:
			return [0, 1, -1, 0, height, 0];
		case 7:
			return [0, -1, -1, 0, height, width];
		case 8:
			return [0, -1, 1, 0, 0, width];
		default:
			return [1, 0, 0, 1, 0, 0];
	}
}

const DEFAULT_LIMITS: PhotoLimits = {
	maxLongSide: PHOTO_MAX_LONG_SIDE,
	maxBytes: PHOTO_MAX_BYTES,
};

export async function resizePhoto(
	photo: Blob,
	codec: PhotoCodec = canvasPhotoCodec,
	limits: PhotoLimits = DEFAULT_LIMITS,
): Promise<ResizedPhoto> {
	let head: Uint8Array;
	try {
		head = new Uint8Array(await photo.slice(0, EXIF_SCAN_BYTES).arrayBuffer());
	} catch {
		throw new PhotoError("unreadable");
	}
	let decoded: DecodedPhoto;
	try {
		decoded = await codec.decode(photo);
	} catch {
		throw new PhotoError("unreadable");
	}
	try {
		const orientation = (await codec.appliesOrientation())
			? 1
			: jpegOrientation(head);
		const upright = orientedSize(decoded, orientation);
		let longSide = limits.maxLongSide;
		for (let step = 0; step < PHOTO_SHRINK_STEPS; step += 1) {
			const output = fittedSize(upright, longSide);
			const drawn = orientedSize(output, orientation);
			const canvas = decoded.draw(
				output,
				drawn,
				orientationMatrix(orientation, drawn),
			);
			try {
				for (const quality of PHOTO_QUALITIES) {
					const blob = await canvas.encode(quality);
					if (blob.size <= limits.maxBytes && blob.size > 0) {
						return {
							blob,
							width: output.width,
							height: output.height,
							quality,
						};
					}
				}
			} finally {
				canvas.release();
			}
			longSide = Math.floor(
				Math.max(output.width, output.height) * PHOTO_SHRINK,
			);
		}
		throw new PhotoError("too-large");
	} finally {
		decoded.close();
	}
}

interface Drawable {
	readonly source: CanvasImageSource;
	readonly width: number;
	readonly height: number;
	close(): void;
}

async function decodeDrawable(photo: Blob): Promise<Drawable> {
	if (typeof createImageBitmap === "function") {
		try {
			const bitmap = await createImageBitmap(photo, {
				imageOrientation: "from-image",
			});
			return {
				source: bitmap,
				width: bitmap.width,
				height: bitmap.height,
				close: () => bitmap.close(),
			};
		} catch {}
	}
	const url = URL.createObjectURL(photo);
	try {
		const image = new Image();
		image.decoding = "async";
		image.src = url;
		await image.decode();
		return {
			source: image,
			width: image.naturalWidth,
			height: image.naturalHeight,
			close: () => URL.revokeObjectURL(url),
		};
	} catch (error) {
		URL.revokeObjectURL(url);
		throw error;
	}
}

function canvasEncode(
	canvas: HTMLCanvasElement,
	quality: number,
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) =>
				blob === null ? reject(new PhotoError("unreadable")) : resolve(blob),
			PHOTO_TYPE,
			quality,
		);
	});
}

function drawOn(
	drawable: Drawable,
	output: PhotoSize,
	drawn: PhotoSize,
	matrix: Matrix,
): PhotoCanvas {
	const canvas = document.createElement("canvas");
	canvas.width = output.width;
	canvas.height = output.height;
	const context = canvas.getContext("2d");
	if (context === null) throw new PhotoError("unreadable");
	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, output.width, output.height);
	context.setTransform(...matrix);
	context.imageSmoothingQuality = "high";
	context.drawImage(drawable.source, 0, 0, drawn.width, drawn.height);
	return {
		encode: (quality) => canvasEncode(canvas, quality),
		release: () => {
			canvas.width = 0;
			canvas.height = 0;
		},
	};
}

let orientationProbe: Promise<boolean> | null = null;

async function probeOrientation(): Promise<boolean> {
	const canvas = document.createElement("canvas");
	canvas.width = 2;
	canvas.height = 1;
	const plain = await canvasEncode(canvas, 0.9);
	const rotated = withOrientation(new Uint8Array(await plain.arrayBuffer()), 6);
	const drawable = await decodeDrawable(
		new Blob([rotated.slice().buffer], { type: PHOTO_TYPE }),
	);
	try {
		return drawable.width < drawable.height;
	} finally {
		drawable.close();
	}
}

export const canvasPhotoCodec: PhotoCodec = {
	async decode(photo) {
		const drawable = await decodeDrawable(photo);
		return {
			width: drawable.width,
			height: drawable.height,
			draw: (output, drawn, matrix) => drawOn(drawable, output, drawn, matrix),
			close: () => drawable.close(),
		};
	},
	appliesOrientation() {
		orientationProbe ??= probeOrientation().catch(() => true);
		return orientationProbe;
	},
};
