import {
	createDemoReportSource,
	type DemoReportSource,
} from "@fnb/demo-analytics";
import type { ReportSource } from "@fnb/reports";
import {
	type BuildDataPackOptions,
	type BuiltPack,
	buildDataPack,
} from "../../../src/pack/build.js";
import { fixedClock } from "../../../src/pack/clock.js";
import type { DataPackRequest } from "../../../src/pack/request.js";

export const GOLDEN_INSTANT = "2026-11-12T03:00:00Z";
export const GOLDEN_AS_OF = "2026-11-11";
export const GOLDEN_FOCUS = "Tăng giá trị hóa đơn buổi chiều";
export const DEMO_STORE_IDS = ["MOCK-S1", "MOCK-S2"] as const;

export function demoSource(instant: string = GOLDEN_INSTANT): DemoReportSource {
	const now = new Date(instant);
	return createDemoReportSource({ now: () => now });
}

export function demoRequest(
	overrides: Partial<DataPackRequest> = {},
): DataPackRequest {
	return {
		storeIds: [...DEMO_STORE_IDS],
		asOf: null,
		horizon: "90d",
		language: "vi",
		focus: null,
		ownerNote: null,
		sample: true,
		...overrides,
	};
}

export function goldenRequest(): DataPackRequest {
	return demoRequest({ focus: GOLDEN_FOCUS });
}

export function buildWith(
	source: ReportSource,
	request: DataPackRequest,
	options: Partial<Omit<BuildDataPackOptions, "source">> & {
		readonly instant?: string;
	} = {},
): Promise<BuiltPack> {
	return buildDataPack(request, {
		source,
		clock: options.clock ?? fixedClock(options.instant ?? GOLDEN_INSTANT),
		fence: options.fence ?? null,
		...(options.onProgress === undefined
			? {}
			: { onProgress: options.onProgress }),
	});
}

export function buildGoldenPack(source: ReportSource): Promise<BuiltPack> {
	return buildWith(source, goldenRequest());
}
