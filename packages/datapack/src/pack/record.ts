import {
	type AnalyticsArgs,
	type AnalyticsFunctionName,
	type ReportFunctionName,
	type ReportSource,
	reportCallIdentity,
	type ThemeArgs,
	type ThemeFunctionName,
} from "@fnb/reports";

export interface RecordedCall {
	readonly key: string;
	readonly name: ReportFunctionName;
	readonly args: Readonly<Record<string, unknown>>;
	readonly rows: readonly unknown[];
}

export interface ReportRecording {
	readonly source: ReportSource;
	readonly calls: readonly RecordedCall[];
}

export function recordingReportSource(source: ReportSource): ReportRecording {
	const calls: RecordedCall[] = [];
	async function track<Row>(
		name: ReportFunctionName,
		args: Readonly<Record<string, unknown>>,
		run: () => Promise<Row[]>,
	): Promise<Row[]> {
		const index = calls.length;
		const key = reportCallIdentity({ name, args } as Parameters<
			typeof reportCallIdentity
		>[0]);
		calls.push({ key, name, args, rows: [] });
		const rows = await run();
		calls[index] = { key, name, args, rows: [...rows] };
		return rows;
	}
	return {
		calls,
		source: {
			kind: source.kind,
			call<N extends AnalyticsFunctionName>(name: N, args: AnalyticsArgs<N>) {
				return track(name, args, () => source.call(name, args));
			},
			callTheme<N extends ThemeFunctionName>(name: N, args: ThemeArgs<N>) {
				return track(name, args, () => source.callTheme(name, args));
			},
		},
	};
}
