import { describe, expect, it } from "vitest";
import { SettingsWriteError } from "../source";
import {
	createDemoNotifySource,
	DEMO_LINK_CHECKS,
	DEMO_TEST_CHECKS,
} from "./demo-notify-source";
import { RATE_LIMITED } from "./source";

const NOW = Date.parse("2026-11-20T03:00:00Z");

function source(now = NOW) {
	let clock = now;
	const demo = createDemoNotifySource({
		now: () => clock,
		storeIds: ["store-1", "store-2"],
	});
	return {
		demo,
		advance: (ms: number) => {
			clock += ms;
		},
	};
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	);
	return error instanceof SettingsWriteError
		? `${error.code}:${error.constraint ?? ""}`
		: null;
}

describe("the demo notify source", () => {
	it("starts with every state the screens show", async () => {
		const { demo } = source();
		const overview = await demo.overview("t");
		expect(overview.destinations.map((row) => row.status).sort()).toEqual([
			"active",
			"failing",
			"pending",
		]);
		expect(overview.destinations.some((row) => row.mutedRules.length > 0)).toBe(
			true,
		);
		const log = await demo.messageLog("t", 0);
		expect(new Set(log.map((row) => row.status))).toEqual(
			new Set(["sent", "held", "uncertain", "failed", "cancelled"]),
		);
		const history = await demo.alertHistory("t", 0);
		expect(history.some((row) => row.foldedOccurrences > 0)).toBe(true);
		expect(history.some((row) => row.state === "open")).toBe(true);
		const digests = await demo.digests("t");
		expect(digests).toHaveLength(14);
		expect(digests.filter((row) => row.revision === 1)).toHaveLength(1);
	});

	it("sends a test after the checks a status poll makes, fails it on the failing destination, and limits tests to one a minute", async () => {
		const { demo, advance } = source();
		const id = await demo.sendTest("demo-dest-bot");
		expect((await demo.messageStatus(id))?.status).toBe("queued");
		for (let check = 1; check < DEMO_TEST_CHECKS; check += 1) {
			await demo.messageStatus(id);
		}
		expect((await demo.messageStatus(id))?.status).toBe("sent");
		expect(await codeOf(demo.sendTest("demo-dest-bot"))).toBe(
			`invalid:${RATE_LIMITED}`,
		);
		advance(60_001);
		expect(await codeOf(demo.sendTest("demo-dest-bot"))).toBeNull();
		const failed = await demo.sendTest("demo-dest-failing");
		for (let check = 0; check <= DEMO_TEST_CHECKS; check += 1) {
			await demo.messageStatus(failed);
		}
		const state = await demo.messageStatus(failed);
		expect(state?.status).toBe("failed");
		expect(state?.lastErrorCode).toBe("token_invalid");
		expect(await codeOf(demo.sendTest("demo-dest-mail"))).toBe(
			"invalid:status",
		);
	});

	it("allows at most 5 tests an hour (boundary)", async () => {
		const { demo, advance } = source();
		for (let index = 0; index < 5; index += 1) {
			expect(await codeOf(demo.sendTest("demo-dest-bot"))).toBeNull();
			advance(61_000);
		}
		expect(await codeOf(demo.sendTest("demo-dest-bot"))).toBe(
			`invalid:${RATE_LIMITED}`,
		);
	});

	it("activates a bot link only after the simulated acceptance and an e-mail at once", async () => {
		const { demo } = source();
		expect(await codeOf(demo.startLink("t", "zalo_bot", null))).toBe(
			"duplicate:",
		);
		const mail = await demo.startLink("t", "email", null);
		expect(mail.status).toBe("active");
		expect(mail.linkCode).toBeNull();
		const telegram = await demo.startLink("t", "telegram", null);
		expect(telegram.linkCode).toMatch(/^FNB-DEMO\d{4}$/);
		const statusOf = async () =>
			(await demo.overview("t")).destinations.find(
				(row) => row.id === telegram.channelId,
			)?.status;
		expect(await statusOf()).toBe("pending");
		for (let check = 1; check < DEMO_LINK_CHECKS; check += 1) await statusOf();
		expect(await statusOf()).toBe("active");
	});

	it("refuses a rule threshold out of range and a store override of a rule that is not store scoped", async () => {
		const { demo } = source();
		const base = {
			storeId: null,
			overrideId: null,
			enabled: true,
			severity: "warning" as const,
			cooldownHours: 0,
		};
		expect(
			await codeOf(
				demo.saveRule("t", {
					...base,
					ruleKey: "revenue_below_baseline",
					params: { ratio: 1.5 },
				}),
			),
		).toBe("invalid:ratio");
		expect(
			await codeOf(
				demo.saveRule("t", {
					...base,
					ruleKey: "nightly_missing",
					storeId: "store-1",
					params: {},
				}),
			),
		).toBe("invalid:");
		await demo.saveRule("t", {
			...base,
			ruleKey: "revenue_below_baseline",
			storeId: "store-1",
			params: { ratio: 0.5 },
		});
		const rules = await demo.rules("t", "store-1");
		const rule = rules.find((row) => row.ruleKey === "revenue_below_baseline");
		expect(rule?.source).toBe("store");
		expect(rule?.params.ratio).toBe(0.5);
		await demo.resetRule("t", rule?.overrideId as string);
		const after = (await demo.rules("t", "store-1")).find(
			(row) => row.ruleKey === "revenue_below_baseline",
		);
		expect(after?.source).toBe("tenant");
	});

	it("resends only uncertain or failed digests and alerts, keeping the original", async () => {
		const { demo } = source();
		expect(await codeOf(demo.resend("demo-msg-sent"))).toBe("invalid:");
		const id = await demo.resend("demo-msg-uncertain");
		const log = await demo.messageLog("t", 0);
		expect(log.find((row) => row.id === id)?.resendOf).toBe(
			"demo-msg-uncertain",
		);
		expect(log.find((row) => row.id === "demo-msg-uncertain")?.status).toBe(
			"uncertain",
		);
	});

	it("stops every own destination and cancels its waiting messages", async () => {
		const { demo } = source();
		const cancelled = await demo.stopMine("t");
		expect(cancelled).toBe(1);
		const overview = await demo.overview("t");
		expect(
			overview.destinations
				.filter((row) => row.mine)
				.every((row) => row.status === "disabled"),
		).toBe(true);
		expect(overview.destinations.some((row) => !row.mine)).toBe(true);
	});
});
