import { DemoSettingsError, type DemoSettingsStore } from "@fnb/demo-analytics";
import { type AuditEntry, SettingsWriteError } from "./source";

const savedAt = new WeakMap<DemoSettingsStore, Map<string, string>>();

function stamps(store: DemoSettingsStore): Map<string, string> {
	let known = savedAt.get(store);
	if (known === undefined) {
		known = new Map();
		savedAt.set(store, known);
	}
	return known;
}

export function demoAuditOf(
	store: DemoSettingsStore,
	key: string,
): AuditEntry | null {
	const changedAt = stamps(store).get(key);
	return changedAt === undefined
		? null
		: { changedAt, author: { kind: "you" } };
}

export function markDemoSaved(
	store: DemoSettingsStore,
	keys: readonly string[],
	now: Date = new Date(),
): void {
	const known = stamps(store);
	const changedAt = now.toISOString();
	for (const key of keys) known.set(key, changedAt);
}

export function forgetDemoSaved(
	store: DemoSettingsStore,
	keys: readonly string[],
): void {
	const known = stamps(store);
	for (const key of keys) known.delete(key);
}

export function demoRowId(area: string, ...parts: readonly (string | null)[]) {
	return [area, ...parts.map((part) => part ?? "")].join(":");
}

const FIELD_CONSTRAINTS: Readonly<Record<string, string>> = {
	"duplicate:code": "stores_code_unique_in_tenant",
	"format:openingHours": "stores_opening_hours_valid",
};

export function demoWriteErrorOf(error: unknown): unknown {
	if (error instanceof DemoSettingsError) {
		const code =
			error.refusal === "duplicate"
				? "duplicate"
				: error.refusal === "frozen"
					? "frozen"
					: "invalid";
		return new SettingsWriteError(
			code,
			FIELD_CONSTRAINTS[`${error.refusal}:${error.field}`] ?? error.field,
		);
	}
	if (error instanceof RangeError) {
		return new SettingsWriteError(
			"invalid",
			/^(\w+) must/.exec(error.message)?.[1] ?? null,
		);
	}
	return error;
}

export function requireUniqueKeys<Row>(
	rows: readonly Row[],
	keyOf: (row: Row) => string,
): void {
	if (new Set(rows.map(keyOf)).size !== rows.length) {
		throw new SettingsWriteError("duplicate");
	}
}

export function byKeys<Row>(
	...keys: readonly ((row: Row) => string | null)[]
): (left: Row, right: Row) => number {
	return (left, right) => {
		for (const key of keys) {
			const a = key(left);
			const b = key(right);
			if (a === b) continue;
			if (a === null) return -1;
			if (b === null) return 1;
			return a < b ? -1 : 1;
		}
		return 0;
	};
}

export function demoWrite<T>(write: () => T): T {
	try {
		return write();
	} catch (error) {
		throw demoWriteErrorOf(error);
	}
}
