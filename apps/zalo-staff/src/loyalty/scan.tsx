import { createContext, type ReactNode, useContext, useMemo } from "react";
import { PERMISSION_DENIED } from "../shift/photo";
import { DEMO_CODES } from "./demo";
import type { ScanPurpose } from "./model";

export type ScanResult =
	| { readonly kind: "content"; readonly content: string }
	| { readonly kind: "refused" }
	| { readonly kind: "cancelled" };

export interface ScanTools {
	scan(purpose: ScanPurpose): Promise<ScanResult>;
}

function errorCode(error: unknown): number | null {
	if (typeof error !== "object" || error === null) return null;
	const code = (error as { readonly code?: unknown }).code;
	return typeof code === "number" ? code : null;
}

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

export const STAND_IN_SCANS: Readonly<Record<ScanPurpose, string>> = {
	member: `fnb-member:1:demo:${DEMO_CODES.live}`,
	redemption: `fnb-redeem:1:${DEMO_CODES.posReward}`,
};

export function standInScanTools(search: string): ScanTools {
	const params = new URLSearchParams(search);
	const mode = params.get("scan");
	const content = params.get("scanCode");
	return {
		async scan(purpose) {
			if (mode === "refused") return { kind: "refused" };
			if (mode === "cancel") return { kind: "cancelled" };
			return { kind: "content", content: content ?? STAND_IN_SCANS[purpose] };
		},
	};
}

export function deviceScanTools(): ScanTools {
	if (import.meta.env.VITE_ZALO_RUNTIME === "zalo") {
		return { scan: () => scanWithZalo() };
	}
	return standInScanTools(
		typeof window === "undefined" ? "" : window.location.search,
	);
}

const ScanToolsContext = createContext<ScanTools | null>(null);

export function ScanToolsProvider({
	tools,
	children,
}: {
	readonly tools: ScanTools;
	readonly children: ReactNode;
}) {
	return (
		<ScanToolsContext.Provider value={tools}>
			{children}
		</ScanToolsContext.Provider>
	);
}

export function useScanTools(): ScanTools {
	const provided = useContext(ScanToolsContext);
	const device = useMemo(() => deviceScanTools(), []);
	return provided ?? device;
}
