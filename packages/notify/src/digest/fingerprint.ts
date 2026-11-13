import type { DigestFinding, DigestModel } from "./model.js";

type Canonical =
	| null
	| boolean
	| number
	| string
	| readonly Canonical[]
	| { readonly [key: string]: Canonical };

export function canonicalJson(value: Canonical): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalJson(entry as Canonical)).join(",")}]`;
	}
	const record = value as { readonly [key: string]: Canonical };
	return `{${Object.keys(record)
		.sort()
		.map(
			(key) => `${JSON.stringify(key)}:${canonicalJson(record[key] ?? null)}`,
		)
		.join(",")}}`;
}

export function findingKey(finding: DigestFinding): string {
	const base = `${finding.ruleKey}:${finding.storeId}`;
	if (finding.ruleKey === "drawer_variance") {
		const shift = finding.values.shift_external_id;
		return `${base}:${shift === undefined ? "" : String(shift)}`;
	}
	return base;
}

export function fingerprintSource(model: DigestModel): Canonical {
	return {
		businessDate: model.businessDate,
		storeIds: [...model.scope.storeIds].sort(),
		net: model.totals.net,
		invoices: model.totals.invoices,
		stores: model.stores
			.map((store) => ({
				storeId: store.storeId,
				net: store.net,
				invoices: store.invoices,
			}))
			.sort((left, right) => left.storeId.localeCompare(right.storeId)),
		findings: model.findings.map(findingKey).sort(),
	};
}

export async function digestFingerprint(model: DigestModel): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonicalJson(fingerprintSource(model))),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export interface FigureChange {
	readonly old: number | null;
	readonly new: number | null;
}

export interface StoreFigureChange {
	readonly storeId: string;
	readonly name: string;
	readonly net: FigureChange;
	readonly invoices: FigureChange;
}

export interface CorrectionDelta {
	readonly net: FigureChange | null;
	readonly invoices: FigureChange | null;
	readonly stores: readonly StoreFigureChange[];
	readonly newFindings: readonly DigestFinding[];
}

function changed(
	before: number | null,
	after: number | null,
): FigureChange | null {
	return Object.is(before, after) ? null : { old: before, new: after };
}

export function correctionDelta(
	before: DigestModel,
	after: DigestModel,
): CorrectionDelta {
	const previousStores = new Map(
		before.stores.map((store) => [store.storeId, store]),
	);
	const stores = after.stores.flatMap((store) => {
		const old = previousStores.get(store.storeId);
		const net = changed(old?.net ?? null, store.net);
		const invoices = changed(old?.invoices ?? null, store.invoices);
		if (net === null && invoices === null) {
			return [];
		}
		return [
			{
				storeId: store.storeId,
				name: store.name,
				net: { old: old?.net ?? null, new: store.net },
				invoices: { old: old?.invoices ?? null, new: store.invoices },
			},
		];
	});
	const known = new Set(before.findings.map(findingKey));
	return {
		net: changed(before.totals.net, after.totals.net),
		invoices: changed(before.totals.invoices, after.totals.invoices),
		stores,
		newFindings: after.findings.filter(
			(finding) => !known.has(findingKey(finding)),
		),
	};
}

export function isEmptyDelta(delta: CorrectionDelta): boolean {
	return (
		delta.net === null &&
		delta.invoices === null &&
		delta.stores.length === 0 &&
		delta.newFindings.length === 0
	);
}
