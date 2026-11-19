import { storeDeepLink } from "../src/data/link";
import { qrPath } from "../src/wallet/qr-path";

export const STANDEE_WIDTH_MM = 105;
export const STANDEE_HEIGHT_MM = 148;
export const STANDEE_SOURCE = "standee";
export const STANDEE_QR_ECC = "Q";
export const STANDEE_QR_BORDER = 4;
export const STANDEE_CALL_TO_ACTION = [
	"Quét mã bằng Zalo",
	"Tham gia thành viên, tích dấu và điểm",
	"mỗi lần mua tại quán",
] as const;

const UNITS = 10;
const WIDTH = STANDEE_WIDTH_MM * UNITS;
const HEIGHT = STANDEE_HEIGHT_MM * UNITS;
const QR_SIDE = 640;
const INK = "#17161A";
const MUTED = "#4A4850";
const FONT = "Roboto, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export interface StandeeBrand {
	readonly displayName: string;
	readonly headerColor: string;
	readonly textColor: "white" | "black";
}

export interface StandeeStore {
	readonly code: string;
	readonly name: string;
}

export interface Standee {
	readonly store: StandeeStore;
	readonly link: string;
	readonly svg: string;
	readonly fileName: string;
}

export function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function fittedSize(text: string, preferred: number, width: number): number {
	const estimate = [...text].length * 0.56;
	return Math.max(24, Math.min(preferred, Math.floor(width / estimate)));
}

function line(
	text: string,
	y: number,
	size: number,
	options: { readonly weight?: number; readonly fill?: string } = {},
): string {
	const fitted = fittedSize(text, size, WIDTH - 120);
	return `<text x="${WIDTH / 2}" y="${y}" font-size="${fitted}" font-weight="${options.weight ?? 400}" fill="${options.fill ?? INK}" text-anchor="middle">${escapeXml(text)}</text>`;
}

export function standeeFileName(store: string): string {
	return `standee-${store.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export function buildStandee(
	brand: StandeeBrand,
	store: StandeeStore,
	linkBase: string,
): Standee {
	if (!HEX_COLOR.test(brand.headerColor)) {
		throw new Error("the brand's header colour must be written like #0A6B56");
	}
	const link = storeDeepLink(linkBase, store.code, STANDEE_SOURCE);
	const qr = qrPath(link, { ecc: STANDEE_QR_ECC, border: STANDEE_QR_BORDER });
	const scale = QR_SIDE / qr.size;
	const qrX = (WIDTH - QR_SIDE) / 2;
	const qrY = 420;
	const headerText = brand.textColor === "white" ? "#FFFFFF" : "#000000";
	const [action, earn, where] = STANDEE_CALL_TO_ACTION;
	const svg = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${STANDEE_WIDTH_MM}mm" height="${STANDEE_HEIGHT_MM}mm" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="${FONT}" data-store="${escapeXml(store.code)}" data-link="${escapeXml(link)}">`,
		`<title>${escapeXml(`${brand.displayName} · ${store.name}`)}</title>`,
		`<rect width="${WIDTH}" height="${HEIGHT}" fill="#FFFFFF"/>`,
		`<rect width="${WIDTH}" height="260" fill="${brand.headerColor}"/>`,
		line(brand.displayName, 160, 72, { weight: 700, fill: headerText }),
		line(store.name, 360, 56, { weight: 700 }),
		`<rect x="${qrX - 10}" y="${qrY - 10}" width="${QR_SIDE + 20}" height="${QR_SIDE + 20}" rx="24" fill="#FFFFFF" stroke="${brand.headerColor}" stroke-width="6"/>`,
		`<g transform="translate(${qrX} ${qrY}) scale(${scale.toFixed(6)})" shape-rendering="crispEdges"><path d="${qr.path}" fill="#000000"/></g>`,
		line(action ?? "", 1180, 60, { weight: 700 }),
		line(earn ?? "", 1260, 42, { fill: MUTED }),
		line(where ?? "", 1316, 42, { fill: MUTED }),
		`<text x="${WIDTH / 2}" y="${HEIGHT - 60}" font-size="20" fill="${MUTED}" text-anchor="middle">${escapeXml(link)}</text>`,
		"</svg>",
	].join("\n");
	return { store, link, svg, fileName: standeeFileName(store.code) };
}

export function printablePage(svg: string): string {
	return [
		"<!doctype html>",
		'<html lang="vi"><head><meta charset="utf-8">',
		`<style>@page{size:${STANDEE_WIDTH_MM}mm ${STANDEE_HEIGHT_MM}mm;margin:0}html,body{margin:0;padding:0}svg{display:block}</style>`,
		"</head><body>",
		svg,
		"</body></html>",
	].join("");
}
