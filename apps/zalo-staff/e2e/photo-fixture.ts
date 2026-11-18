import type { Browser, Locator, Page } from "@playwright/test";

export const PHOTO_WIDTH = 4000;
export const PHOTO_HEIGHT = 3000;
export const MAX_PHOTO_BYTES = 1_000_000;
export const MAX_LONG_SIDE = 1280;

function withOrientationSix(bytes: Buffer): Buffer {
	const segment = Buffer.from([
		0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d,
		0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	]);
	return Buffer.concat([bytes.subarray(0, 2), segment, bytes.subarray(2)]);
}

export interface SyntheticPhoto {
	readonly name: string;
	readonly mimeType: string;
	readonly buffer: Buffer;
}

export async function sidewaysPhoto(browser: Browser): Promise<SyntheticPhoto> {
	const context = await browser.newContext();
	const maker = await context.newPage();
	const base64 = await maker.evaluate(
		async ({ width, height }) => {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext("2d");
			if (context === null) throw new Error("no canvas");
			const image = context.createImageData(width, height);
			const pixels = new Uint32Array(image.data.buffer);
			let seed = 7;
			for (let i = 0; i < pixels.length; i += 1) {
				seed = (seed * 1103515245 + 12345) >>> 0;
				pixels[i] = (seed | 0xff000000) >>> 0;
			}
			context.putImageData(image, 0, 0);
			context.fillStyle = "#ffffff";
			context.fillRect(0, 0, width / 4, height / 8);
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, "image/jpeg", 0.9),
			);
			if (blob === null) throw new Error("no JPEG");
			const bytes = new Uint8Array(await blob.arrayBuffer());
			let text = "";
			for (let i = 0; i < bytes.length; i += 0x8000)
				text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
			return btoa(text);
		},
		{ width: PHOTO_WIDTH, height: PHOTO_HEIGHT },
	);
	await context.close();
	return {
		name: "anh-chup.jpg",
		mimeType: "image/jpeg",
		buffer: withOrientationSix(Buffer.from(base64, "base64")),
	};
}

export async function takePhotoWith(
	page: Page,
	button: Locator,
	photo: SyntheticPhoto,
): Promise<void> {
	const chooser = page.waitForEvent("filechooser");
	await button.click();
	await (await chooser).setFiles(photo);
}

export interface ShownPhoto {
	readonly width: number;
	readonly height: number;
	readonly bytes: number;
	readonly naturalWidth: number;
	readonly naturalHeight: number;
}

export async function shownPhoto(preview: Locator): Promise<ShownPhoto> {
	await preview.waitFor();
	await preview.evaluate((image: HTMLImageElement) => image.decode());
	return preview.evaluate((image: HTMLImageElement) => ({
		width: Number(image.dataset.width),
		height: Number(image.dataset.height),
		bytes: Number(image.dataset.bytes),
		naturalWidth: image.naturalWidth,
		naturalHeight: image.naturalHeight,
	}));
}

const SOF_MARKERS = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function jpegSize(
	bytes: Buffer,
): { readonly width: number; readonly height: number } | null {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;
	while (offset + 9 < bytes.length) {
		if (bytes[offset] !== 0xff) return null;
		const marker = bytes[offset + 1] ?? 0;
		const length = bytes.readUInt16BE(offset + 2);
		if (SOF_MARKERS.has(marker)) {
			return {
				height: bytes.readUInt16BE(offset + 5),
				width: bytes.readUInt16BE(offset + 7),
			};
		}
		offset += 2 + length;
	}
	return null;
}
