import { deflateSync } from "node:zlib";

export type Rgba = readonly [number, number, number, number];

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) {
		value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}
	return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(type, 4, "ascii");
	const tail = Buffer.alloc(4);
	tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
	return Buffer.concat([head, body, tail]);
}

export function encodePng(
	width: number,
	height: number,
	paint: (x: number, y: number) => Rgba,
	options: { readonly alpha?: boolean } = {},
): Buffer {
	const alpha = options.alpha ?? false;
	const channels = alpha ? 4 : 3;
	const raw = Buffer.alloc(height * (width * channels + 1));
	for (let y = 0; y < height; y += 1) {
		const row = y * (width * channels + 1);
		raw[row] = y % 2 === 0 ? 0 : 2;
		for (let x = 0; x < width; x += 1) {
			const pixel = paint(x, y);
			for (let channel = 0; channel < channels; channel += 1) {
				const value = pixel[channel] ?? 0;
				const above =
					y > 0 ? (y % 2 === 0 ? 0 : (paint(x, y - 1)[channel] ?? 0)) : 0;
				raw[row + 1 + x * channels + channel] = (value - above) & 0xff;
			}
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = alpha ? 6 : 2;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", new Uint8Array()),
	]);
}

export function hex(color: string): Rgba {
	return [
		Number.parseInt(color.slice(1, 3), 16),
		Number.parseInt(color.slice(3, 5), 16),
		Number.parseInt(color.slice(5, 7), 16),
		255,
	];
}

export function markLogo(
	size: number,
	background: string,
	mark: string,
): (x: number, y: number) => Rgba {
	const back = hex(background);
	const front = hex(mark);
	const centre = (size - 1) / 2;
	const outer = size * 0.3;
	const inner = size * 0.18;
	return (x, y) => {
		const distance = Math.hypot(x - centre, y - centre);
		return distance <= outer && distance >= inner ? front : back;
	};
}
