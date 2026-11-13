import type {
	AnalyticsArgs,
	AnalyticsFunctionName,
	AnalyticsRow,
	AnalyticsSource,
} from "@fnb/reports";

export interface RecordedCall {
	readonly name: AnalyticsFunctionName;
	readonly args: Readonly<Record<string, unknown>>;
	readonly rows: readonly unknown[];
}

export interface RecordingSource extends AnalyticsSource {
	recorded(): readonly RecordedCall[];
}

export function recordingSource(source: AnalyticsSource): RecordingSource {
	const calls: RecordedCall[] = [];
	return {
		kind: source.kind,
		async call<N extends AnalyticsFunctionName>(
			name: N,
			args: AnalyticsArgs<N>,
		): Promise<AnalyticsRow<N>[]> {
			const rows = await source.call(name, args);
			calls.push({
				name,
				args: { ...(args as Record<string, unknown>) },
				rows,
			});
			return rows;
		},
		recorded: () => [...calls],
	};
}

export function recordedRows<N extends AnalyticsFunctionName>(
	calls: readonly RecordedCall[],
	name: N,
	matches: (args: Readonly<Record<string, unknown>>) => boolean = () => true,
): readonly AnalyticsRow<N>[] {
	const found = calls.find(
		(entry) => entry.name === name && matches(entry.args),
	);
	return (found?.rows ?? []) as readonly AnalyticsRow<N>[];
}
