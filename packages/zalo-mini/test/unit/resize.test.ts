import { describe, expect, it } from "vitest";
import {
	type DecodedPhoto,
	fittedSize,
	jpegOrientation,
	type Matrix,
	type Orientation,
	orientationMatrix,
	orientedSize,
	PHOTO_MAX_BYTES,
	PHOTO_MAX_LONG_SIDE,
	PHOTO_QUALITIES,
	type PhotoCodec,
	PhotoError,
	type PhotoSize,
	resizePhoto,
	withOrientation,
} from "../../src/data/photo";

const SOI = [0xff, 0xd8];
const BODY = [0xff, 0xdb, 0x00, 0x04, 0x01, 0x02, 0xff, 0xda, 0x00, 0x02];

function jpeg(...segments: number[][]): Uint8Array {
	return Uint8Array.from([...SOI, ...segments.flat(), ...BODY, 0xff, 0xd9]);
}

function exifSegment(orientation: number, little: boolean): number[] {
	const short = (value: number) =>
		little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff];
	const long = (value: number) =>
		little
			? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24]
			: [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
	const tiff = [
		...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
		...short(0x2a),
		...long(8),
		...short(2),
		...short(0x0100),
		...short(4),
		...long(1),
		...long(4032),
		...short(0x0112),
		...short(3),
		...long(1),
		...short(orientation),
		0,
		0,
		...long(0),
	];
	const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
	const length = payload.length + 2;
	return [0xff, 0xe1, length >> 8, length & 0xff, ...payload];
}

const JFIF = [0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00];

interface Drawn {
	readonly output: PhotoSize;
	readonly drawn: PhotoSize;
	readonly matrix: Matrix;
	readonly qualities: number[];
}

function fakeCodec(
	size: PhotoSize,
	options: {
		readonly orients?: boolean;
		readonly bytes?: (output: PhotoSize, quality: number) => number;
		readonly unreadable?: boolean;
	} = {},
) {
	const drawings: Drawn[] = [];
	let closed = 0;
	const bytes =
		options.bytes ??
		((output: PhotoSize, quality: number) =>
			Math.round(output.width * output.height * quality * 0.4));
	const codec: PhotoCodec = {
		async decode() {
			if (options.unreadable) throw new Error("not an image");
			const decoded: DecodedPhoto = {
				...size,
				draw(output, drawn, matrix) {
					const record: Drawn = { output, drawn, matrix, qualities: [] };
					drawings.push(record);
					return {
						async encode(quality) {
							record.qualities.push(quality);
							return new Blob([new Uint8Array(bytes(output, quality))], {
								type: "image/jpeg",
							});
						},
						release() {},
					};
				},
				close() {
					closed += 1;
				},
			};
			return decoded;
		},
		async appliesOrientation() {
			return options.orients ?? true;
		},
	};
	return { codec, drawings, closed: () => closed };
}

function photoFile(bytes: Uint8Array = jpeg(JFIF)): Blob {
	return new Blob([bytes.slice().buffer], { type: "image/jpeg" });
}

describe("the EXIF orientation of a JPEG", () => {
	it("is read from a big- or little-endian APP1 segment after other segments", () => {
		for (const orientation of [1, 3, 6, 8]) {
			expect(jpegOrientation(jpeg(exifSegment(orientation, false)))).toBe(
				orientation,
			);
			expect(jpegOrientation(jpeg(JFIF, exifSegment(orientation, true)))).toBe(
				orientation,
			);
		}
	});

	it("is 1 without EXIF, for a value outside 1 to 8, for a truncated file and for a file that is not a JPEG", () => {
		expect(jpegOrientation(jpeg(JFIF))).toBe(1);
		expect(jpegOrientation(jpeg(exifSegment(9, false)))).toBe(1);
		expect(jpegOrientation(jpeg(exifSegment(6, true)).slice(0, 20))).toBe(1);
		expect(jpegOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
	});

	it("can be written into a JPEG, which keeps its data after the new segment", () => {
		const original = jpeg(JFIF);
		const rotated = withOrientation(original, 6);
		expect(jpegOrientation(rotated)).toBe(6);
		expect([...rotated.slice(-original.length + 2)]).toEqual([
			...original.slice(2),
		]);
		expect(() => withOrientation(Uint8Array.from([1, 2, 3]), 6)).toThrow(
			"not a JPEG",
		);
	});
});

describe("the size of a resized photo", () => {
	it("keeps the long side at 1280 px at most and never enlarges", () => {
		expect(fittedSize({ width: 4032, height: 3024 }, 1280)).toEqual({
			width: 1280,
			height: 960,
		});
		expect(fittedSize({ width: 3024, height: 4032 }, 1280)).toEqual({
			width: 960,
			height: 1280,
		});
		expect(fittedSize({ width: 800, height: 600 }, 1280)).toEqual({
			width: 800,
			height: 600,
		});
		expect(fittedSize({ width: 10000, height: 10 }, 1280)).toEqual({
			width: 1280,
			height: 1,
		});
	});

	it("swaps the sides for the four quarter-turn orientations", () => {
		const size = { width: 4, height: 3 };
		for (const orientation of [1, 2, 3, 4] as Orientation[])
			expect(orientedSize(size, orientation)).toEqual(size);
		for (const orientation of [5, 6, 7, 8] as Orientation[])
			expect(orientedSize(size, orientation)).toEqual({ width: 3, height: 4 });
	});

	it("draws each orientation upright", () => {
		const drawn = { width: 40, height: 30 };
		const apply = (matrix: Matrix, x: number, y: number) => [
			matrix[0] * x + matrix[2] * y + matrix[4],
			matrix[1] * x + matrix[3] * y + matrix[5],
		];
		expect(orientationMatrix(1, drawn)).toEqual([1, 0, 0, 1, 0, 0]);
		expect(apply(orientationMatrix(3, drawn), 0, 0)).toEqual([40, 30]);
		expect(apply(orientationMatrix(6, drawn), 0, 0)).toEqual([30, 0]);
		expect(apply(orientationMatrix(6, drawn), 40, 30)).toEqual([0, 40]);
		expect(apply(orientationMatrix(8, drawn), 0, 0)).toEqual([0, 40]);
		expect(apply(orientationMatrix(2, drawn), 0, 0)).toEqual([40, 0]);
	});
});

describe("resizing a photo before upload", () => {
	it("turns a 12 MP photo into a 1280 px JPEG under 1 MB at the first quality", async () => {
		const { codec, drawings, closed } = fakeCodec({
			width: 4032,
			height: 3024,
		});
		const result = await resizePhoto(photoFile(), codec);
		expect(result).toMatchObject({ width: 1280, height: 960, quality: 0.85 });
		expect(result.blob.size).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
		expect(Math.max(result.width, result.height)).toBe(PHOTO_MAX_LONG_SIDE);
		expect(drawings).toHaveLength(1);
		expect(drawings[0]?.matrix).toEqual([1, 0, 0, 1, 0, 0]);
		expect(closed()).toBe(1);
	});

	it("turns a sideways photo upright when the decoder does not, and trusts a decoder that does", async () => {
		const sideways = photoFile(withOrientation(jpeg(JFIF), 6));
		const manual = fakeCodec({ width: 4032, height: 3024 }, { orients: false });
		const upright = await resizePhoto(sideways, manual.codec);
		expect(upright).toMatchObject({ width: 960, height: 1280 });
		expect(manual.drawings[0]?.drawn).toEqual({ width: 1280, height: 960 });
		expect(manual.drawings[0]?.matrix).toEqual([0, 1, -1, 0, 960, 0]);

		const automatic = fakeCodec(
			{ width: 3024, height: 4032 },
			{ orients: true },
		);
		const kept = await resizePhoto(sideways, automatic.codec);
		expect(kept).toMatchObject({ width: 960, height: 1280 });
		expect(automatic.drawings[0]?.matrix).toEqual([1, 0, 0, 1, 0, 0]);
	});

	it("lowers the quality step by step until the file is under 1 MB", async () => {
		const { codec, drawings } = fakeCodec(
			{ width: 4032, height: 3024 },
			{ bytes: (_output, quality) => (quality > 0.6 ? 1_400_000 : 900_000) },
		);
		const result = await resizePhoto(photoFile(), codec);
		expect(result.quality).toBe(0.55);
		expect(drawings[0]?.qualities).toEqual([0.85, 0.75, 0.65, 0.55]);
		expect(result.blob.size).toBe(900_000);
	});

	it("shrinks the picture when even the lowest quality is too large, and gives up after a few steps", async () => {
		const shrinking = fakeCodec(
			{ width: 4032, height: 3024 },
			{
				bytes: (output) =>
					Math.max(output.width, output.height) > 1000 ? 2_000_000 : 500_000,
			},
		);
		const smaller = await resizePhoto(photoFile(), shrinking.codec);
		expect(smaller).toMatchObject({ width: 960, height: 720, quality: 0.85 });
		expect(shrinking.drawings[0]?.qualities).toEqual([...PHOTO_QUALITIES]);

		const hopeless = fakeCodec(
			{ width: 4032, height: 3024 },
			{ bytes: () => 5_000_000 },
		);
		const error = await resizePhoto(photoFile(), hopeless.codec).catch(
			(e) => e,
		);
		expect(error).toBeInstanceOf(PhotoError);
		expect(error.reason).toBe("too-large");
		expect(hopeless.closed()).toBe(1);
	});

	it("refuses a file that does not decode as a picture", async () => {
		const { codec } = fakeCodec({ width: 1, height: 1 }, { unreadable: true });
		const error = await resizePhoto(photoFile(), codec).catch((e) => e);
		expect(error).toBeInstanceOf(PhotoError);
		expect(error.reason).toBe("unreadable");
	});
});
