import { DEMO_COUNTER_QR } from "../demo/fixtures";

export type ScanResult =
	| { readonly kind: "content"; readonly content: string }
	| { readonly kind: "refused" }
	| { readonly kind: "cancelled" };

export type Scan = () => Promise<ScanResult>;

/** Zalo's code when the camera permission is refused */
export const PERMISSION_DENIED = -201;

function errorCode(error: unknown): number | null {
	if (typeof error !== "object" || error === null) return null;
	const code = (error as { readonly code?: unknown }).code;
	return typeof code === "number" ? code : null;
}

/** The camera of Zalo (scanQRCode), only in the Zalo runtime; elsewhere the stand-in below answers. */
export async function scanWithZalo(): Promise<ScanResult> {
	if (import.meta.env.VITE_ZALO_RUNTIME !== "zalo")
		return { kind: "cancelled" };
	try {
		const { scanContent } = await import("./zalo-scan");
		const content = await scanContent();
		return content.trim() === ""
			? { kind: "cancelled" }
			: { kind: "content", content };
	} catch (error) {
		return errorCode(error) === PERMISSION_DENIED
			? { kind: "refused" }
			: { kind: "cancelled" };
	}
}

/**
 * The stand-in camera of the browser runs (tests, design review), driven by the address like the staff app's:
 * `scan=refused` or `scan=cancel`, or `scanCode=<the text the camera reads>`; otherwise it reads the demo store's
 * live counter QR.
 */
export function standInScan(search: string): Scan {
	const params = new URLSearchParams(search);
	const mode = params.get("scan");
	const content = params.get("scanCode");
	return async () => {
		if (mode === "refused") return { kind: "refused" };
		if (mode === "cancel") return { kind: "cancelled" };
		return { kind: "content", content: content ?? DEMO_COUNTER_QR };
	};
}

export function deviceScan(): Scan {
	if (import.meta.env.VITE_ZALO_RUNTIME === "zalo") return scanWithZalo;
	return standInScan(
		typeof window === "undefined" ? "" : window.location.search,
	);
}
