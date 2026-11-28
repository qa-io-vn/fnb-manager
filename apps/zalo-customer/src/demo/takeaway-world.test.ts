import {
	createMemoryStorage,
	createZaloCustomerSessionClient,
} from "@fnb/zalo-mini";
import {
	createRestOrderingClient,
	type OrderingClient,
	type PaymentMethod,
} from "@fnb/zalo-mini/ordering";
import { describe, expect, it } from "vitest";
import { DEMO_ORDERING_STORE, DEMO_SIZES } from "./ordering-fixtures";
import { createOrderingWorld } from "./ordering-world";
import { createDemoWorld, DEMO_DEFAULTS } from "./world";

// Test design (ISTQB) for the demo world's takeaway (C17), the stand-in of customer_takeaway_slots,
// customer_place_order and customer_change_pickup that the browser tests run on: it must answer as pgTAP 304 and 305
// prove the server does, or the app is tested against a fiction.
// - boundary values of the instant (C17-U1): 14:05 → 14:30 first and "Càng sớm" 14:20; 22:30 → 22:45 still free; 22:31
//   → tomorrow from 07:00; 23:00 closed → a pre-order from 07:00; 06:50 → 07:15;
// - equivalence partitions of capacity (C17-U3): 0, 1 (limit − 1) and 2 (the limit) places taken; a hold whose 10
//   minutes passed gives its place back;
// - a decision table of the placement's refusals (C17-I1, C17-I5) and of the change (C17-S3: another customer's order
//   is unknown).

const PICK = DEMO_SIZES.bananaCake;
const local = (text: string) => Date.parse(`${text}+07:00`);
const iso = (text: string) => new Date(local(text)).toISOString();

async function setup(start: string, reason: string | null = null) {
	let clock = local(start);
	const world = createDemoWorld(
		{ ...DEMO_DEFAULTS, onlinePayments: true, takeaway: true },
		() => clock,
	);
	const ordering = createOrderingWorld(
		world.now,
		reason,
		true,
		false,
		true,
		true,
	);
	world.extend(ordering);
	const sessions = createZaloCustomerSessionClient({
		endpoint: "demo",
		brandKey: "brand-1",
		publishableKey: "demo",
		storage: createMemoryStorage(),
		getAccessToken: async () => "mock-zalo-access-token",
		fetch: world.sessionFetch,
		now: () => clock,
	});
	const state = await sessions.connect();
	if (state.status !== "ready") throw new Error("no session");
	const client: OrderingClient = createRestOrderingClient(
		world.rest(state.session.accessToken),
	);
	let requests = 0;
	const place = (
		pickup: string | null,
		payment: PaymentMethod = "zalo_checkout",
	) => {
		requests += 1;
		return client.placeOrder({
			request_id: `12345678-1234-4234-8234-${String(requests).padStart(12, "0")}`,
			store: DEMO_ORDERING_STORE,
			type: "takeaway",
			...(pickup === null ? {} : { pickup_at: iso(pickup) }),
			lines: [{ size: PICK, qty: 1 }],
			payment,
			expected_total: 25000,
		});
	};
	return {
		client,
		till: ordering.till,
		place,
		setClock: (text: string) => {
			clock = local(text);
		},
		firstFree: async () => {
			const slots = await client.takeawaySlots(DEMO_ORDERING_STORE);
			const free = slots.slots.find((slot) => slot.available);
			return { slots, first: free?.start ?? null };
		},
	};
}

describe("the demo's slots (C17-U1, C17-U2)", () => {
	it("open at 14:05: today, 14:30 first, Càng sớm 14:20, the morning passed", async () => {
		const { firstFree } = await setup("2026-11-27T14:05:00");
		const { slots, first } = await firstFree();
		expect(slots.date).toBe("2026-11-27");
		expect(first).toBe(iso("2026-11-27T14:30:00"));
		expect(slots.asapAt).toBe(iso("2026-11-27T14:20:00"));
		expect(slots.slots[0]?.reason).toBe("passed");
		expect(slots.lastPickupAt).toBe(iso("2026-11-27T22:45:00"));
	});

	it("at 22:30 the last slot 22:45 is still free; at 22:31 the slots are tomorrow's from 07:00", async () => {
		const world = await setup("2026-11-27T22:30:00");
		expect((await world.firstFree()).first).toBe(iso("2026-11-27T22:45:00"));
		world.setClock("2026-11-27T22:31:00");
		const later = await world.firstFree();
		expect(later.slots.date).toBe("2026-11-28");
		expect(later.first).toBe(iso("2026-11-28T07:00:00"));
		expect(later.slots.preOrder).toBe(false);
	});

	it("closed at 23:00: a pre-order from tomorrow's opening, no Càng sớm; at 06:50 the first is 07:15", async () => {
		const world = await setup("2026-11-27T23:00:00", "closed_now");
		const night = await world.firstFree();
		expect(night.slots.preOrder).toBe(true);
		expect(night.slots.asapAt).toBeNull();
		expect(night.first).toBe(iso("2026-11-28T07:00:00"));
		world.setClock("2026-11-28T06:50:00");
		expect((await world.firstFree()).first).toBe(iso("2026-11-28T07:15:00"));
	});

	it("a paused store has no slot", async () => {
		const world = await setup("2026-11-27T14:05:00", "paused");
		const answer = await world.client.takeawaySlots(DEMO_ORDERING_STORE);
		expect(answer.state).toBe("refused");
		expect(answer.refusal).toBe("paused");
	});
});

describe("booking and holding a slot (C17-U3, C17-I1, C17-I3)", () => {
	it("fills at its limit of two and frees a hold after its 10 minutes", async () => {
		const world = await setup("2026-11-27T14:05:00");
		const state = async () =>
			(await world.client.takeawaySlots(DEMO_ORDERING_STORE)).slots.find(
				(slot) => slot.start === iso("2026-11-27T15:00:00"),
			)?.reason ?? "free";
		expect(await state()).toBe("free");
		const first = await world.place("2026-11-27T15:00:00");
		expect(first.state).toBe("awaiting_payment");
		expect(first.order?.paymentDueAt).toBe(iso("2026-11-27T14:15:00"));
		expect(await state()).toBe("free");
		world.till.fillSlot(iso("2026-11-27T15:00:00"));
		expect(await state()).toBe("full");
		const third = await world.place("2026-11-27T15:00:00");
		expect(third.refusal).toBe("slot_full");
		expect(third.pickupAt).toBe(iso("2026-11-27T15:00:00"));
		world.setClock("2026-11-27T14:15:00");
		expect(await state()).toBe("free");
	});

	it("refuses a passed, a tampered, a closed or another day's time and the counter", async () => {
		const world = await setup("2026-11-27T14:05:00");
		expect((await world.place("2026-11-27T14:15:00")).refusal).toBe(
			"slot_passed",
		);
		expect((await world.place("2026-11-27T14:37:00")).refusal).toBe(
			"pickup_time_invalid",
		);
		expect((await world.place("2026-11-27T23:00:00")).refusal).toBe("closed");
		expect((await world.place("2026-11-28T08:00:00")).refusal).toBe(
			"pickup_time_invalid",
		);
		expect((await world.place("2026-11-27T14:30:00", "counter")).refusal).toBe(
			"payment_not_allowed",
		);
		expect(world.till.placements()).toBe(0);
	});

	it("books the next morning while closed, but not Càng sớm", async () => {
		const world = await setup("2026-11-27T23:30:00", "closed_now");
		expect((await world.place(null)).refusal).toBe("closed_now");
		const booked = await world.place("2026-11-28T07:30:00");
		expect(booked.state).toBe("awaiting_payment");
		expect(booked.order?.pickupAt).toBe(iso("2026-11-28T07:30:00"));
		expect(booked.order?.startAt).toBe(iso("2026-11-28T07:15:00"));
	});
});

describe("moving a booking while its payment is open (C17-S3)", () => {
	it("moves the customer's own booking, gives the old place back and refuses another customer's order", async () => {
		const world = await setup("2026-11-27T14:05:00");
		const booked = await world.place("2026-11-27T15:00:00");
		const id = booked.order?.id ?? "";
		const moved = await world.client.changePickup(
			id,
			iso("2026-11-27T15:30:00"),
		);
		expect(moved.state).toBe("changed");
		expect(world.till.pickupOf(id)).toBe(iso("2026-11-27T15:30:00"));
		const replay = await world.client.changePickup(
			id,
			iso("2026-11-27T15:30:00"),
		);
		expect(replay.state === "changed" && replay.replayed).toBe(true);
		const foreign = await world.client.changePickup(
			"aaaaaaaa-0000-4000-8000-000000000001",
			iso("2026-11-27T15:45:00"),
		);
		expect(foreign.state === "refused" && foreign.refusal).toBe(
			"unknown_order",
		);
		world.setClock("2026-11-27T14:16:00");
		const late = await world.client.changePickup(
			id,
			iso("2026-11-27T16:00:00"),
		);
		expect(late.state === "refused" && late.refusal).toBe("not_changeable");
	});
});
