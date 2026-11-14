import { createDemoReportSource, sharedDemoDays } from "@fnb/demo-analytics";
import type { ReportSource } from "@fnb/reports";

export function createWebDemoAnalyticsSource(): ReportSource {
	return createDemoReportSource({
		now: () => new Date(),
		days: sharedDemoDays(),
		validateRows: import.meta.env.DEV,
	});
}
