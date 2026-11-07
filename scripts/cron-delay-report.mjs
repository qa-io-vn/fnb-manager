import { execFileSync } from "node:child_process";

const probes = [
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

function latestScheduledBefore(startedAt, minutes) {
	const candidates = [];
	for (const hourOffset of [0, -1]) {
		for (const minute of minutes) {
			const candidate = new Date(startedAt);
			candidate.setUTCHours(startedAt.getUTCHours() + hourOffset, minute, 0, 0);
			if (candidate <= startedAt) candidates.push(candidate);
		}
	}
	return candidates.sort((a, b) => b - a)[0];
}

function percentile(sortedValues, fraction) {
	if (sortedValues.length === 0) return 0;
	const index = Math.min(
		sortedValues.length - 1,
		Math.floor(fraction * (sortedValues.length - 1)),
	);
	return sortedValues[index];
}

for (const probe of probes) {
	const runs = fetchScheduledRuns(probe.workflow);
	const delaysMinutes = runs
		.map(
			(startedAt) =>
				(startedAt - latestScheduledBefore(startedAt, probe.minutes)) / 60000,
		)
		.sort((a, b) => a - b);
	const byHour = new Map();
	runs.forEach((startedAt, index) => {
		const hour = startedAt.getUTCHours();
		const bucket = byHour.get(hour) ?? [];
		bucket.push(delaysMinutes[index]);
		byHour.set(hour, bucket);
	});
	console.log(`${probe.workflow}: ${runs.length} scheduled runs`);
	if (runs.length === 0) continue;
	console.log(
		`  median ${percentile(delaysMinutes, 0.5).toFixed(1)} min · p90 ${percentile(delaysMinutes, 0.9).toFixed(1)} min · p95 ${percentile(delaysMinutes, 0.95).toFixed(1)} min · max ${delaysMinutes.at(-1).toFixed(1)} min`,
	);
	for (const [hour, bucket] of [...byHour.entries()].sort(
		(a, b) => a[0] - b[0],
	)) {
		const sorted = [...bucket].sort((a, b) => a - b);
		console.log(
			`  ${String(hour).padStart(2, "0")}:xx UTC  n=${sorted.length}  median ${percentile(sorted, 0.5).toFixed(1)}  p95 ${percentile(sorted, 0.95).toFixed(1)}`,
		);
	}
}
