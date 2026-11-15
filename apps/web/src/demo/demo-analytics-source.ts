import { createDemoReportSource, sharedDemoDays } from "@fnb/demo-analytics";
import type { ReportSource } from "@fnb/reports";
import { sharedDemoSettings } from "./demo-settings";

export function createWebDemoAnalyticsSource(): ReportSource {
	return createDemoReportSource({
		now: () => new Date(),
		days: sharedDemoDays(),
		settings: sharedDemoSettings(),
		validateRows: import.meta.env.DEV,
	});
}
