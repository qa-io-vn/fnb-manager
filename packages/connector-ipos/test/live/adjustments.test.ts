import type { PosConnector } from "@fnb/connector-core";
import {
	checkAdjustments,
	checkFlags,
	describeViolations,
} from "@fnb/connector-core/conformance";
import {
	type CanonicalAdjustment,
	type CanonicalStore,
	canonicalAdjustmentSchema,
	type DataQualityFlag,
	shiftIsoDate,
} from "@fnb/core";
import { describe, expect, it } from "vitest";
import { createIposConnector, vietnamDaysAgo } from "../../src/index.js";
import {
	hasAppAccessToken,
	type LiveAccount,
	liveEnabled,
	loadIposAccounts,
	resolveAppAccessToken,
	timed,
} from "./accounts.js";

const accounts = loadIposAccounts();

const LOOKBACK_DAYS = 30;
const RECENT_DAY = vietnamDaysAgo(1);
const WINDOW = {
	fromDate: shiftIsoDate(RECENT_DAY, -(LOOKBACK_DAYS - 1)),
	toDate: RECENT_DAY,
};

function countBy<T>(items: readonly T[], key: (item: T) => string): string {
	const counts = new Map<string, number>();
	for (const item of items) {
		counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
	}
	return (
		[...counts]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([name, count]) => `${name}=${count}`)
			.join(" ") || "none"
	);
}

interface LiveSession {
	connector: PosConnector;
	stores: CanonicalStore[];
	flags: DataQualityFlag[];
}

async function connect(account: LiveAccount): Promise<LiveSession> {
	const flags: DataQualityFlag[] = [];
	const connector = createIposConnector({ onFlag: (flag) => flags.push(flag) });
	await timed("authenticate", () =>
		connector.authenticate({
			email: account.email,
			password: account.password,
			appAccessToken: resolveAppAccessToken(account),
		}),
	);
	const stores = await timed("discoverStores", () =>
		connector.discoverStores(),
	);
	return { connector, stores, flags };
}

interface EditRaw {
	origin_tran_id?: string | null;
	first_origin_tran_id?: string | null;
	total_amount_origin?: number;
	total_amount?: number;
}

function originSource(adjustment: CanonicalAdjustment): string {
	if (adjustment.kind !== "edited") {
		return "not_edit";
	}
	const raw = adjustment.raw as EditRaw;
	if (raw.origin_tran_id?.trim()) {
		return "origin_tran_id";
	}
	if (raw.first_origin_tran_id?.trim()) {
		return "first_origin_tran_id";
	}
	return "none";
}

function editDirection(adjustment: CanonicalAdjustment): string {
	const raw = adjustment.raw as EditRaw;
	const before = raw.total_amount_origin ?? 0;
	const after = raw.total_amount ?? 0;
	return after > before ? "increased" : after < before ? "decreased" : "same";
}

function schemaIssues(adjustments: readonly CanonicalAdjustment[]): string[] {
	return adjustments.flatMap((adjustment) => {
		const result = canonicalAdjustmentSchema.safeParse(adjustment);
		return result.success
			? []
			: [result.error.issues[0]?.message ?? "invalid adjustment"];
	});
}

describe.skipIf(!liveEnabled)("iPOS connector live adjustments", () => {
	for (const [position, account] of accounts.entries()) {
		describe.skipIf(!hasAppAccessToken(account))(
			`account #${position + 1}`,
			() => {
				it(`fetches ${LOOKBACK_DAYS} days of adjustments per store without schema errors and passes the adjustment rules`, {
					timeout: 600_000,
				}, async () => {
					const session = await connect(account);
					expect(session.stores.length).toBeGreaterThan(0);
					for (const store of session.stores) {
						const label = `store#${session.stores.indexOf(store) + 1}`;
						const flagsBefore = session.flags.length;
						const adjustments = await timed(`${label} fetchAdjustments`, () =>
							session.connector.fetchAdjustments(store, WINDOW),
						);
						const flags = session.flags.slice(flagsBefore);
						const edits = adjustments.filter(
							(adjustment) => adjustment.kind === "edited",
						);
						console.log(
							`[live] ${label} ${WINDOW.fromDate}..${WINDOW.toDate}: adjustments=${adjustments.length} byKind(${countBy(adjustments, (adjustment) => adjustment.kind)}) withReason=${adjustments.filter((adjustment) => adjustment.reason !== undefined).length} linkedEdits=${edits.filter((adjustment) => adjustment.relatedSaleExternalId !== undefined).length} editOrigin(${countBy(edits, originSource)}) editDirection(${countBy(edits, editDirection)}) unsuffixedRemovals=${adjustments.filter((adjustment) => adjustment.kind === "line_removed" && !adjustment.lineExternalId?.endsWith("_REMOVE")).length} flags=${flags.length} (${countBy(flags, (flag) => flag.code)})`,
						);
						expect(schemaIssues(adjustments)).toEqual([]);
						const violations = checkAdjustments(adjustments, {
							store,
							window: WINDOW,
							moneyTolerance: 1,
						});
						expect(violations, describeViolations(violations)).toEqual([]);
						expect(checkFlags(flags)).toEqual([]);
					}
				});
			},
		);
	}
});
