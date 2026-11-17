import {
	createDemoReportSource,
	type DemoReportSource,
} from "@fnb/demo-analytics";
import type { ReportSource } from "@fnb/reports";
import {
	type BuildDataPackOptions,
	type BuiltPack,
	buildPackWith,
} from "../../../src/pack/build.js";
import { fixedClock } from "../../../src/pack/clock.js";
import type {
	DataPackRequest,
	PackLanguage,
} from "../../../src/pack/request.js";
import {
	PROMPT_ID,
	PROMPT_VERSION,
	type StrategyPrompt,
} from "../../../src/prompt/prompt.js";

export const GOLDEN_INSTANT = "2026-11-12T03:00:00Z";
export const GOLDEN_AS_OF = "2026-11-11";
export const GOLDEN_FOCUS = "Tăng giá trị hóa đơn buổi chiều";
export const DEMO_STORE_IDS = ["MOCK-S1", "MOCK-S2"] as const;

const STAND_IN_TEXT: Readonly<Record<PackLanguage, string>> = {
	vi: "Lời nhắc thay thế cho kiểm thử, đến khi có lời nhắc 1.0.0.",
	en: "A stand-in prompt for the tests, until prompt 1.0.0 exists.",
};

export function standInPrompt(language: PackLanguage): StrategyPrompt {
	return {
		id: PROMPT_ID,
		version: PROMPT_VERSION,
		language,
		text: STAND_IN_TEXT[language],
	};
}

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
	return buildPackWith(
		request,
		{
			source,
			clock: options.clock ?? fixedClock(options.instant ?? GOLDEN_INSTANT),
			fence: options.fence ?? null,
			...(options.onProgress === undefined
				? {}
				: { onProgress: options.onProgress }),
		},
		standInPrompt,
	);
}

export function buildGoldenPack(source: ReportSource): Promise<BuiltPack> {
	return buildWith(source, goldenRequest());
}
