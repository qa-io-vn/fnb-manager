import {
	createStandInSessionClient,
	fromZmpNativeStorage,
	type MemberRole,
	type ResizedPhoto,
	type SessionClient,
} from "@fnb/zalo-mini";
import { MiniApp } from "@fnb/zalo-mini/react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { getAccessToken, nativeStorage } from "zmp-sdk";
import type { RevenueVisibility } from "../home/model";
import { catalogs } from "../i18n/catalog";
import {
	type PhotoTake,
	type PhotoTools,
	PhotoToolsProvider,
} from "../shift/photo";
import {
	createSampleShiftSource,
	type SampleShiftSource,
	type ShiftSampleSettings,
} from "../shift/sample";
import { ShiftScreen } from "../shift/shift-screen";
import type { ShiftSource } from "../shift/source";

export const MORNING = new Date("2026-11-18T01:30:00Z");
export const AFTERNOON = new Date("2026-11-18T07:00:00Z");
export const EVENING = new Date("2026-11-18T14:30:00Z");
export const BOTH_STORES = ["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"];

export interface ShiftHarness {
	readonly source: SampleShiftSource;
	readonly tools: FakePhotoTools;
}

export interface FakePhotoTools extends PhotoTools {
	readonly taken: number;
	readonly resized: number;
}

export function fakePhotoTools(
	takes: readonly PhotoTake[] = [],
): FakePhotoTools {
	const queue = [...takes];
	let taken = 0;
	let resized = 0;
	return {
		get taken() {
			return taken;
		},
		get resized() {
			return resized;
		},
		async take() {
			taken += 1;
			return (
				queue.shift() ?? {
					kind: "photo",
					blob: new Blob([new Uint8Array(4_000_000)], { type: "image/jpeg" }),
				}
			);
		},
		async resize(): Promise<ResizedPhoto> {
			resized += 1;
			return {
				blob: new Blob([new Uint8Array(350_000)], { type: "image/jpeg" }),
				width: 1280,
				height: 960,
				quality: 0.85,
			};
		},
	};
}

export function stubObjectUrls(): void {
	let next = 0;
	URL.createObjectURL = vi.fn(() => {
		next += 1;
		return `blob:test/${next}`;
	});
	URL.revokeObjectURL = vi.fn();
}

export interface ShiftOptions {
	readonly role?: MemberRole;
	readonly stores?: readonly string[];
	readonly visibility?: RevenueVisibility;
	readonly settings?: Partial<ShiftSampleSettings>;
	readonly tools?: FakePhotoTools;
	readonly source?: ShiftSource;
	readonly language?: "vi" | "en";
	readonly client?: (client: SessionClient) => SessionClient;
}

export function renderShift(options: ShiftOptions = {}): ShiftHarness {
	nativeStorage.clear();
	const role = options.role ?? "staff";
	const stores =
		options.stores ??
		(role === "staff" ? BOTH_STORES.slice(0, 1) : BOTH_STORES);
	const standIn = createStandInSessionClient({
		settings: { scenario: "bound", delayMs: 0 },
		member: { displayName: "Thành viên thử", role, stores },
		storage: fromZmpNativeStorage(nativeStorage),
		getAccessToken: () => getAccessToken(),
	});
	const source = createSampleShiftSource({
		visibility: options.visibility ?? "all",
		delayMs: 0,
		failFirstUpload: false,
		checklistTaken: false,
		unmatchedCount: false,
		...options.settings,
	});
	const tools = options.tools ?? fakePhotoTools();
	render(
		<MiniApp
			language={options.language ?? "vi"}
			catalogs={catalogs}
			sessionClient={options.client ? options.client(standIn) : standIn}
			routes={[
				{
					path: "/",
					element: (
						<PhotoToolsProvider tools={tools}>
							<ShiftScreen sourceFor={() => options.source ?? source} />
						</PhotoToolsProvider>
					),
				},
			]}
			tabs={[]}
			standInHeader={null}
		/>,
	);
	return { source, tools };
}

export async function boardReady(): Promise<HTMLElement> {
	return screen.findByTestId("shift-board", {}, { timeout: 4000 });
}

export function primaryActions(
	scope: HTMLElement = document.body,
): HTMLElement[] {
	const dialog = scope.querySelector("[role=dialog]");
	const root = (dialog ?? scope) as HTMLElement;
	return [...root.querySelectorAll<HTMLElement>("[data-action=primary]")];
}
