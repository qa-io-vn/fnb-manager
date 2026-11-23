// The second half of G-15 (CI integration): 200 generated sequences of earn,
// confirm, hold, confirm of a hold, release, clawback, expire and adjust, run
// through the @fnb/core ledger model and embedded in
// supabase/tests/244_loyalty_ledger_sequence_replay.sql, which runs them through
// the SQL functions and compares the balances after every step.
// ISTQB techniques: model-based testing (the model is the oracle of the SQL),
// state transition testing (the generated sequences), coverage of the
// equivalence partitions of every step (each kind accepted and refused, a
// clawback that writes off, a debit in the midnight-to-run window, a pending
// earn that outlives an expiry run) and security (no phone in the fixture).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	buildLedgerReplay,
	KIND,
	LEDGER_REPLAY_SEQUENCES,
	LEDGER_REPLAY_STEPS,
	type LedgerReplayFixture,
	LedgerReplayRunner,
	replaySequence,
} from "../fixtures/loyalty-ledger-replay.js";

const sqlTestPath = fileURLToPath(
	new URL(
		"../../../../supabase/tests/244_loyalty_ledger_sequence_replay.sql",
		import.meta.url,
	),
);
const EMBEDDED = /\$ledger\$(\{.*\})\$ledger\$/s;

// UPDATE_LOYALTY_REPLAY=1 rewrites the copy embedded in the pgTAP file, as it
// does for the liability replay.
if (process.env.UPDATE_LOYALTY_REPLAY === "1" && existsSync(sqlTestPath)) {
	const json = JSON.stringify(buildLedgerReplay());
	const sql = readFileSync(sqlTestPath, "utf8");
	writeFileSync(
		sqlTestPath,
		sql.replace(EMBEDDED, () => `$ledger$${json}$ledger$`),
	);
}

function embedded(): LedgerReplayFixture {
	const sql = readFileSync(sqlTestPath, "utf8");
	const match = EMBEDDED.exec(sql);
	if (match?.[1] === undefined) {
		throw new Error("no embedded fixture in the pgTAP file");
	}
	return JSON.parse(match[1]) as LedgerReplayFixture;
}

describe("the generated ledger sequences (G-15, second half: CI integration against supabase/tests/244_loyalty_ledger_sequence_replay.sql)", () => {
	const fixture = buildLedgerReplay();

	it("is embedded verbatim in the pgTAP replay", () => {
		expect(existsSync(sqlTestPath)).toBe(true);
		expect(embedded()).toEqual(fixture);
	});

	it("has 200 sequences of at most 20 steps, deterministic from the seed", () => {
		expect(fixture.sequences).toHaveLength(LEDGER_REPLAY_SEQUENCES);
		expect(
			fixture.sequences.every(
				(sequence) =>
					sequence.steps.length > 0 &&
					sequence.steps.length <= LEDGER_REPLAY_STEPS,
			),
		).toBe(true);
		expect(buildLedgerReplay()).toEqual(fixture);
		expect(buildLedgerReplay(1)).not.toEqual(fixture);
	});

	it("holds the independent calculation: each sequence run again through a fresh model gives every stored step", () => {
		for (const sequence of fixture.sequences) {
			expect(replaySequence(sequence)).toEqual({
				steps: sequence.steps,
				rows: sequence.rows,
				counts: sequence.counts,
			});
		}
	});

	it("never expects a balance below zero (ADR-046), at any step or at the end", () => {
		for (const sequence of fixture.sequences) {
			for (const step of sequence.steps) {
				expect(Math.min(...step.slice(6))).toBeGreaterThanOrEqual(0);
			}
			expect(Math.min(...sequence.rows)).toBeGreaterThanOrEqual(0);
		}
	});

	it("covers every kind accepted and refused, write-offs, debits in the midnight-to-run window and pending earns through an expiry run", () => {
		const seen = new Set<string>();
		let writeOffs = 0;
		let windowDebits = 0;
		let pendingThroughExpiry = 0;
		for (const sequence of fixture.sequences) {
			const runner = new LedgerReplayRunner();
			for (const step of sequence.steps) {
				const before = runner.ledger.entries.length;
				const accepted = runner.apply(step.slice(0, 5));
				seen.add(`${step[1]}:${accepted ? 1 : 0}`);
				const written = runner.ledger.entries.slice(before);
				const kind = step[1];
				if (
					(kind === KIND.hold || kind === KIND.adjust) &&
					written.length > 1 &&
					written[0]?.kind === "expire"
				) {
					windowDebits += 1;
				}
				if (kind === KIND.expire) {
					const at = runner.moment;
					const entries = runner.ledger.entries;
					pendingThroughExpiry += entries.filter(
						(earn) =>
							earn.kind === "earn" &&
							earn.pending &&
							earn.expiresAt !== null &&
							earn.expiresAt <= at &&
							!entries.some(
								(row) =>
									(row.kind === "confirm" || row.kind === "clawback") &&
									row.sourceId === earn.id &&
									row.occurredAt <= at,
							),
					).length;
				}
			}
			writeOffs += runner.ledger.entries.filter(
				(row) => row.kind === "clawback" && row.reason?.includes("; short by"),
			).length;
		}
		for (const kind of Object.values(KIND)) {
			expect(seen.has(`${kind}:1`), `kind ${kind} accepted`).toBe(true);
			if (kind !== KIND.expire) {
				expect(seen.has(`${kind}:0`), `kind ${kind} refused`).toBe(true);
			}
		}
		expect(writeOffs).toBeGreaterThan(10);
		expect(windowDebits).toBeGreaterThan(5);
		expect(pendingThroughExpiry).toBeGreaterThan(5);
	});

	it("puts no phone and no personal datum in the fixture (security)", () => {
		const text = JSON.stringify(fixture);
		expect(text).not.toMatch(/(?:\+?84|\b0)[1-9]\d{8,9}\b/);
		expect(text).not.toMatch(/"name"|"phone"|"customer"/);
	});
});
