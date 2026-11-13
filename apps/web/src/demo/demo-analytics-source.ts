import { createDemoAnalyticsSource, sharedDemoDays } from "@fnb/demo-analytics";
import type { AnalyticsSource } from "@fnb/reports";

export function createWebDemoAnalyticsSource(): AnalyticsSource {
	return createDemoAnalyticsSource({
		now: () => new Date(),
		days: sharedDemoDays(),
		validateRows: import.meta.env.DEV,
	});
}
