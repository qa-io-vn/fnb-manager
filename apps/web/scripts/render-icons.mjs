import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const iconSource = readFileSync(join(publicRoot, "favicon.svg"), "utf8");
const backgroundColour = iconSource.match(
	/id="background"[^>]*fill="(#[0-9a-f]{6})"/i,
)?.[1];
if (!backgroundColour) {
	throw new Error("favicon.svg needs a rect with id=background and a fill");
}

const MASKABLE_SAFE_SCALE = 0.8;
const pngIcons = [
	{ file: "icon-192.png", size: 192, scale: 1, fill: null },
	{ file: "icon-512.png", size: 512, scale: 1, fill: null },
	{
		file: "icon-maskable-512.png",
		size: 512,
		scale: MASKABLE_SAFE_SCALE,
		fill: backgroundColour,
	},
	{ file: "apple-touch-icon.png", size: 180, scale: 1, fill: backgroundColour },
];
const faviconSizes = [16, 32, 48];

function pageFor(size, scale, fill) {
	const source = `data:image/svg+xml;base64,${Buffer.from(iconSource).toString("base64")}`;
	const inset = (size * (1 - scale)) / 2;
	const drawn = size * scale;
	return `<!doctype html><html><body style="margin:0">
<div style="position:absolute;left:0;top:0;width:${size}px;height:${size}px;background:${fill ?? "transparent"}">
<img alt="" src="${source}" style="position:absolute;left:${inset}px;top:${inset}px;width:${drawn}px;height:${drawn}px">
</div></body></html>`;
}

async function renderPng(page, size, scale, fill) {
	await page.setContent(pageFor(size, scale, fill));
	await page.locator("img").evaluate((image) => image.decode());
	return page.screenshot({
		clip: { x: 0, y: 0, width: size, height: size },
		omitBackground: true,
	});
}

function icoOf(images) {
	const ICONDIR_BYTES = 6;
	const ENTRY_BYTES = 16;
	const header = Buffer.alloc(ICONDIR_BYTES);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	let offset = ICONDIR_BYTES + ENTRY_BYTES * images.length;
	const entries = images.map(({ size, png }) => {
		const entry = Buffer.alloc(ENTRY_BYTES);
		entry.writeUInt8(size, 0);
		entry.writeUInt8(size, 1);
		entry.writeUInt16LE(1, 4);
		entry.writeUInt16LE(32, 6);
		entry.writeUInt32LE(png.length, 8);
		entry.writeUInt32LE(offset, 12);
		offset += png.length;
		return entry;
	});
	return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

const browser = await chromium.launch();
try {
	const page = await browser.newPage({
		viewport: { width: 600, height: 600 },
		deviceScaleFactor: 1,
	});
	for (const icon of pngIcons) {
		const png = await renderPng(page, icon.size, icon.scale, icon.fill);
		writeFileSync(join(publicRoot, icon.file), png);
		console.log(`${icon.file}: ${icon.size} px, ${png.length} bytes`);
	}
	const favicons = [];
	for (const size of faviconSizes) {
		favicons.push({ size, png: await renderPng(page, size, 1, null) });
	}
	const ico = icoOf(favicons);
	writeFileSync(join(publicRoot, "favicon.ico"), ico);
	console.log(
		`favicon.ico: ${faviconSizes.join(", ")} px, ${ico.length} bytes`,
	);
} finally {
	await browser.close();
}
