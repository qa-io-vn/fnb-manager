import type { ReportFunctionName } from "@fnb/reports";

export interface RecordedCall {
	readonly key: string;
	readonly name: ReportFunctionName;
	readonly args: Readonly<Record<string, unknown>>;
	readonly rows: readonly unknown[];
}
