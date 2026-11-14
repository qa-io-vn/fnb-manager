export const lazySources = [
	/src\/components\/report-card\/echarts-view\.tsx$/,
	/src\/demo\/demo-row-source\.ts$/,
	/src\/demo\/demo-analytics-source\.ts$/,
	/src\/pages\/reports\/(day|week|month|year)\/[a-z]+-page\.tsx$/,
	/src\/pages\/themes\/[a-z-]+\/[a-z-]+-page\.tsx$/,
	/src\/data\/supabase-analytics-source\.ts$/,
];

export const eagerSources = [];

export function isEagerSource(key, sources = eagerSources) {
	return sources.some((pattern) => pattern.test(key));
}

export function unmatchedLazySources(keys, sources = lazySources) {
	return sources.filter((pattern) => !keys.some((key) => pattern.test(key)));
}

export function isLazySource(key, sources = lazySources) {
	return sources.some((pattern) => pattern.test(key));
}
