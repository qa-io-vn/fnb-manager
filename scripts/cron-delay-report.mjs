#!/usr/bin/env node
// How late GitHub starts the scheduled cron probes (docs/operations.md 2.3, FR-OPS-10).
//
//   node scripts/cron-delay-report.mjs              read the probes' scheduled runs with gh and report
//   node scripts/cron-delay-report.mjs --self-test  check the slot attribution on synthetic run lists
//
// Each run is attributed to its own scheduled slot: GitHub starts scheduled runs in order and never twice for one
// slot, so walking the runs from the newest back, each run claims the latest slot at or before its start that is
// earlier than the slot of the run after it. A run that starts more than one slot spacing late (after an outage, in a
// burst) is therefore measured from its own slot, and a slot no run claimed between the first and the last claimed
// slot is counted as skipped.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MINUTE = 60_000;

export const PROBES = [
	{ workflow: "cron-probe-peak.yml", minutes: [0, 30] },
	{ workflow: "cron-probe-offpeak.yml", minutes: [7, 37] },
];

function fetchScheduledRuns(workflow) {
	const output = execFileSync(
		"gh",
		[
			"api",
			`repos/{owner}/{repo}/actions/workflows/${workflow}/runs?event=schedule&per_page=100`,
			"--paginate",
			"--jq",
			".workflow_runs[] | .run_started_at",
		],
		{ encoding: "utf8" },
	);
	return output
		.split("\n")
		.filter(Boolean)
		.map((value) => new Date(value));
}

/** The scheduled slots of the given minutes past each hour, from `from` to `to` inclusive. */
export function slotsBetween(from, to, minutes) {
	const slots = [];
	const cursor = new Date(from);
	cursor.setUTCMinutes(0, 0, 0);
	while (cursor <= to) {
		for (const minute of [...minutes].sort((a, b) => a - b)) {
			const slot = new Date(cursor);
			slot.setUTCMinutes(minute, 0, 0);
			if (slot >= from && slot <= to) slots.push(slot);
		}
		cursor.setUTCHours(cursor.getUTCHours() + 1);
	}
	return slots;
}

/** Smallest distance between two consecutive slot minutes, wrapping round the hour. */
export function slotSpacingMinutes(minutes) {
	const sorted = [...minutes].sort((a, b) => a - b);
	let spacing = 60;
	sorted.forEach((minute, index) => {
		const next = index + 1 < sorted.length ? sorted[index + 1] : sorted[0] + 60;
		spacing = Math.min(spacing, next - minute || 60);
	});
	return spacing;
}

/**
 * Attributes every run to its own slot. Returns the runs with their slot and delay in minutes (oldest first),
 * the skipped slots between the first and the last attributed slot, and the runs no slot could be found for.
 */
export function attributeRuns(startedAtList, minutes) {
	const runs = [...startedAtList].sort((a, b) => a - b);
	if (runs.length === 0) return { runs: [], skipped: [], unattributed: [] };
	const lookback = new Date(runs[0].getTime() - 24 * 60 * MINUTE);
	const slots = slotsBetween(lookback, runs.at(-1), minutes);
	const attributed = [];
	const unattributed = [];
	let slotIndex = slots.length - 1;
	for (let index = runs.length - 1; index >= 0; index -= 1) {
		const startedAt = runs[index];
		while (slotIndex >= 0 && slots[slotIndex] > startedAt) slotIndex -= 1;
		if (slotIndex < 0) {
			unattributed.push(startedAt);
			continue;
		}
		const slot = slots[slotIndex];
		attributed.push({
			startedAt,
			slot,
			delayMinutes: (startedAt - slot) / MINUTE,
		});
		slotIndex -= 1;
	}
	attributed.reverse();
	const claimed = new Set(attributed.map((run) => run.slot.getTime()));
	const skipped =
		attributed.length === 0
			? []
			: slots.filter(
					(slot) =>
						slot >= attributed[0].slot &&
						slot <= attributed.at(-1).slot &&
						!claimed.has(slot.getTime()),
				);
	return { runs: attributed, skipped, unattributed: unattributed.reverse() };
}

export function percentile(sortedValues, fraction) {
	if (sortedValues.length === 0) return 0;
	const index = Math.min(
		sortedValues.length - 1,
		Math.floor(fraction * (sortedValues.length - 1)),
	);
	return sortedValues[index];
}

export function summarise(probe, startedAtList) {
	const { runs, skipped, unattributed } = attributeRuns(
		startedAtList,
		probe.minutes,
	);
	const lines = [`${probe.workflow}: ${runs.length} scheduled runs`];
	if (runs.length === 0) return lines;
	const spacing = slotSpacingMinutes(probe.minutes);
	const delays = runs.map((run) => run.delayMinutes).sort((a, b) => a - b);
	const lateBeyondSpacing = runs.filter((run) => run.delayMinutes >= spacing);
	lines.push(
		`  median ${percentile(delays, 0.5).toFixed(1)} min · p90 ${percentile(delays, 0.9).toFixed(1)} min · p95 ${percentile(delays, 0.95).toFixed(1)} min · max ${delays.at(-1).toFixed(1)} min`,
		`  slots ${runs.length + skipped.length} · skipped ${skipped.length} · later than one slot spacing (${spacing} min) ${lateBeyondSpacing.length}${unattributed.length > 0 ? ` · unattributed ${unattributed.length}` : ""}`,
	);
	const byHour = new Map();
	for (const run of runs) {
		const hour = run.slot.getUTCHours();
		const bucket = byHour.get(hour) ?? [];
		bucket.push(run.delayMinutes);
		byHour.set(hour, bucket);
	}
	for (const [hour, bucket] of [...byHour.entries()].sort(
		(a, b) => a[0] - b[0],
	)) {
		const sorted = [...bucket].sort((a, b) => a - b);
		lines.push(
			`  ${String(hour).padStart(2, "0")}:xx UTC  n=${sorted.length}  median ${percentile(sorted, 0.5).toFixed(1)}  p95 ${percentile(sorted, 0.95).toFixed(1)}`,
		);
	}
	return lines;
}

function selfTest() {
	const at = (text) => new Date(`2026-11-20T${text}:00Z`);
	const minutes = [0, 30];
	const failures = [];
	const expect = (label, actual, wanted) => {
		const left = JSON.stringify(actual);
		const right = JSON.stringify(wanted);
		if (left !== right) failures.push(`${label}: got ${left}, wanted ${right}`);
	};
	const slotOf = (result) =>
		result.runs.map((run) => run.slot.toISOString().slice(11, 16));
	const delayOf = (result) => result.runs.map((run) => run.delayMinutes);

	const onTime = attributeRuns(
		[at("10:04"), at("10:33"), at("11:05")],
		minutes,
	);
	expect("on-time runs keep their slots", slotOf(onTime), [
		"10:00",
		"10:30",
		"11:00",
	]);
	expect("on-time delays stay under one spacing", delayOf(onTime), [4, 3, 5]);
	expect("on-time runs skip nothing", onTime.skipped.length, 0);

	const burst = attributeRuns(
		[at("10:02"), at("11:35"), at("11:36"), at("11:37"), at("12:01")],
		minutes,
	);
	expect("a burst after an outage goes to its own slots", slotOf(burst), [
		"10:00",
		"10:30",
		"11:00",
		"11:30",
		"12:00",
	]);
	expect(
		"a run more than two slots late is measured from its own slot",
		burst.runs[1].delayMinutes,
		65,
	);
	expect("a burst that covers every slot skips none", burst.skipped.length, 0);

	const gap = attributeRuns([at("10:01"), at("11:02"), at("11:31")], minutes);
	expect(
		"a missing run leaves its slot skipped",
		gap.skipped.map((slot) => slot.toISOString().slice(11, 16)),
		["10:30"],
	);
	expect("runs after a gap keep their slots", slotOf(gap), [
		"10:00",
		"11:00",
		"11:30",
	]);

	const unordered = attributeRuns(
		[at("11:31"), at("10:01"), at("11:02")],
		minutes,
	);
	expect("input order does not matter", slotOf(unordered), slotOf(gap));

	expect("no runs give an empty report", attributeRuns([], minutes), {
		runs: [],
		skipped: [],
		unattributed: [],
	});
	expect("the peak probe's slot spacing", slotSpacingMinutes([0, 30]), 30);
	expect("a single minute is an hourly spacing", slotSpacingMinutes([15]), 60);
	expect(
		"uneven minutes give the smallest gap",
		slotSpacingMinutes([7, 37, 50]),
		13,
	);

	const lines = summarise(PROBES[0], [
		at("10:02"),
		at("11:35"),
		at("11:36"),
		at("11:37"),
		at("12:31"),
	]);
	expect(
		"the summary counts slots, skipped slots and very late runs",
		lines[2],
		"  slots 6 · skipped 1 · later than one slot spacing (30 min) 2",
	);

	if (failures.length > 0) {
		for (const failure of failures) console.error(`self-test: ${failure}`);
		process.exit(1);
	}
	console.log("cron-delay-report self-test: all checks passed");
}

function main(argv) {
	if (argv.includes("--self-test")) {
		selfTest();
		return;
	}
	for (const probe of PROBES) {
		for (const line of summarise(probe, fetchScheduledRuns(probe.workflow))) {
			console.log(line);
		}
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main(process.argv.slice(2));
}
