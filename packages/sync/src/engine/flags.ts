import type { DataQualityFlag, FlagSeverity } from "@fnb/core";

export interface FlagCount {
	code: string;
	severity: FlagSeverity;
	count: number;
}

export class FlagCollector {
	private readonly counts = new Map<string, FlagCount>();

	readonly sink = (flag: DataQualityFlag): void => {
		this.add(flag.code, flag.severity);
	};

	add(code: string, severity: FlagSeverity, count = 1): void {
		if (count <= 0) {
			return;
		}
		const key = `${severity}|${code}`;
		const existing = this.counts.get(key);
		this.counts.set(key, {
			code,
			severity,
			count: (existing?.count ?? 0) + count,
		});
	}

	addAll(flags: readonly DataQualityFlag[]): void {
		for (const flag of flags) {
			this.sink(flag);
		}
	}

	list(): FlagCount[] {
		return [...this.counts.values()].sort((left, right) =>
			left.severity === right.severity
				? left.code < right.code
					? -1
					: left.code > right.code
						? 1
						: 0
				: left.severity === "warn"
					? -1
					: 1,
		);
	}

	total(severity: FlagSeverity): number {
		return this.list()
			.filter((flag) => flag.severity === severity)
			.reduce((sum, flag) => sum + flag.count, 0);
	}
}
