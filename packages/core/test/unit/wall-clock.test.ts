import { describe, expect, it } from "vitest";
import { formattedWallClock, wallClockIn } from "../../src/index.js";

const ZONES = [
	"Asia/Ho_Chi_Minh",
	"America/New_York",
	"Australia/Lord_Howe",
	"Asia/Kathmandu",
	"Europe/Dublin",
	"America/St_Johns",
	"Pacific/Chatham",
	"UTC",
];

const MINUTE = 60_000;

function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 4_294_967_296;
	};
}

describe("wallClockIn", () => {
	it("equals the time zone database at random instants of 1900 to 2040", () => {
		const random = seeded(20_261_108);
		const from = Date.UTC(1900, 0, 1);
		const to = Date.UTC(2040, 0, 1);
		for (const zone of ZONES) {
			for (let index = 0; index < 1_500; index += 1) {
				const instant = new Date(from + Math.floor(random() * (to - from)));
				expect(
					wallClockIn(instant, zone),
					`${zone} ${instant.toISOString()}`,
				).toEqual(formattedWallClock(instant, zone));
			}
		}
	});

	it("equals the time zone database minute by minute around offset changes", () => {
		const transitions: [string, string][] = [
			["America/New_York", "2026-03-08T05:00:00Z"],
			["America/New_York", "2026-11-01T05:00:00Z"],
			["Australia/Lord_Howe", "2026-04-04T14:00:00Z"],
			["Australia/Lord_Howe", "2026-10-03T15:00:00Z"],
			["Europe/Dublin", "2026-03-29T00:00:00Z"],
			["America/St_Johns", "2026-11-01T03:00:00Z"],
			["Pacific/Chatham", "2026-04-04T13:00:00Z"],
			["Asia/Ho_Chi_Minh", "1975-06-12T16:00:00Z"],
		];
		for (const [zone, around] of transitions) {
			const centre = Date.parse(around);
			for (let offset = -180; offset <= 180; offset += 1) {
				for (const second of [0, 59]) {
					const instant = new Date(
						centre + offset * MINUTE + second * 1000 + 999,
					);
					expect(
						wallClockIn(instant, zone),
						`${zone} ${instant.toISOString()}`,
					).toEqual(formattedWallClock(instant, zone));
				}
			}
		}
	});

	it("still rejects an unknown time zone", () => {
		expect(() => wallClockIn(new Date(), "Mars/Base")).toThrow(RangeError);
	});
});
