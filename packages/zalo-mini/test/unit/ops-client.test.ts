import { describe, expect, it } from "vitest";
import {
	createRestOpsClient,
	OPS_PHOTO_NAME,
	photoName,
	photoPathIn,
	readChecklistRun,
	readDueChecklist,
	readIncident,
	tokenSubject,
} from "../../src/data/ops-client";
import type { RestClient } from "../../src/data/rest-client";
import type { StorageClient } from "../../src/data/storage-client";

const TENANT = "11111111-1111-4111-8111-111111111111";
const STORE = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const MEMBER = "44444444-4444-4444-8444-444444444444";

const RUN_ANSWER = {
	run_id: RUN,
	tenant_id: TENANT,
	store_id: STORE,
	template_id: "t-1",
	template_version: 2,
	title: "Mở ca",
	shift_phase: "opening",
	business_date: "2026-11-18",
	status: "open",
	started_by: MEMBER,
	started_at: "2026-11-18T00:05:00+00:00",
	finished_at: null,
	photo_bucket: "ops-brand-1",
	photo_prefix: `${TENANT}/${STORE}/run/${RUN}/`,
	items_total: 2,
	items_done: 1,
	items: [
		{
			answer_id: "a-1",
			item_id: "i-1",
			position: 1,
			label: "Lau quầy",
			requires_photo: true,
			number_unit: null,
			done: true,
			number_value: null,
			photo_path: `${TENANT}/${STORE}/run/${RUN}/p-1.jpg`,
			photo_removed: false,
			answered_by: MEMBER,
			answered_at: "2026-11-18T00:06:00+00:00",
		},
		{
			answer_id: "a-2",
			item_id: "i-2",
			position: 2,
			label: "Nhiệt độ tủ mát",
			requires_photo: false,
			number_unit: "°C",
			done: false,
			number_value: "4.5",
			photo_path: null,
			photo_removed: false,
			answered_by: null,
			answered_at: null,
		},
	],
};

function fakeRest(answers: Readonly<Record<string, unknown>>) {
	const calls: { kind: string; name: string; args: unknown }[] = [];
	const rest: RestClient = {
		async select(table, query) {
			calls.push({ kind: "select", name: table, args: query });
			return (answers[table] as unknown[]) ?? [];
		},
		async rpc(fn, args = {}) {
			calls.push({ kind: "rpc", name: fn, args });
			return answers[fn] ?? null;
		},
	};
	return { rest, calls };
}

const uploads: { bucket: string; name: string }[] = [];
const storage: StorageClient = {
	async upload(bucket, name) {
		uploads.push({ bucket, name });
	},
	async download() {
		return new Blob(["x"]);
	},
};

function token(claims: Record<string, unknown>): string {
	const encode = (value: unknown) =>
		btoa(JSON.stringify(value))
			.replace(/=+$/, "")
			.replace(/\+/g, "-")
			.replace(/\//g, "_");
	return `${encode({ alg: "HS256" })}.${encode(claims)}.signature`;
}

describe("the operations client", () => {
	it("knows the member from the session token's subject, and nobody from anything else", () => {
		expect(tokenSubject(token({ sub: MEMBER, role: "authenticated" }))).toBe(
			MEMBER,
		);
		expect(tokenSubject("stand-in-session")).toBeNull();
		expect(tokenSubject(token({ sub: "not-a-uuid" }))).toBeNull();
		expect(tokenSubject("a.%%%.c")).toBeNull();
	});

	it("reads a run with its items, numbers given as text and the photo path", () => {
		const run = readChecklistRun(RUN_ANSWER);
		expect(run).toMatchObject({
			runId: RUN,
			templateVersion: 2,
			shiftPhase: "opening",
			status: "open",
			photo: {
				bucket: "ops-brand-1",
				prefix: `${TENANT}/${STORE}/run/${RUN}/`,
			},
			itemsDone: 1,
		});
		expect(run.items[1]).toMatchObject({ numberUnit: "°C", numberValue: 4.5 });
		expect(
			readChecklistRun({ ...RUN_ANSWER, photo_bucket: null }).photo,
		).toBeNull();
		expect(() =>
			readChecklistRun({ ...RUN_ANSWER, shift_phase: "night" }),
		).toThrow();
		expect(() => readChecklistRun({ ...RUN_ANSWER, items: null })).toThrow();
	});

	it("reads a due checklist with and without today's run", () => {
		const row = {
			template_id: "t-1",
			title: "Mở ca",
			shift_phase: "opening",
			template_version: 3,
			every_store: true,
			items: 4,
			photo_items: 2,
			business_date: "2026-11-18",
			run_id: null,
			run_status: null,
			run_started_by: null,
			run_started_at: null,
			run_finished_at: null,
		};
		expect(readDueChecklist(row)).toMatchObject({
			items: 4,
			photoItems: 2,
			run: null,
		});
		expect(
			readDueChecklist({
				...row,
				run_id: RUN,
				run_status: "finished",
				run_started_by: MEMBER,
				run_started_at: "2026-11-18T00:05:00+00:00",
				run_finished_at: "2026-11-18T00:30:00+00:00",
			}).run,
		).toMatchObject({ id: RUN, status: "finished", startedBy: MEMBER });
	});

	it("calls each function with the parameter names of the database", async () => {
		const { rest, calls } = fakeRest({
			due_checklists: [],
			start_checklist_run: RUN_ANSWER,
			finish_checklist_run: { ...RUN_ANSWER, status: "finished" },
			save_checklist_answer: {
				answer_id: "a-2",
				run_id: RUN,
				item_id: "i-2",
				done: true,
				number_value: 4,
				photo_path: null,
				photo_removed: false,
				answered_by: MEMBER,
				answered_at: "2026-11-18T00:07:00+00:00",
			},
			record_cash_count: {
				cash_count_id: "c-1",
				business_date: "2026-11-18",
				counted_at: "2026-11-18T15:00:00+00:00",
				status: "active",
				matched: false,
			},
			reopen_cash_count: { cash_count_id: "c-1", status: "reopened" },
			write_handover: { handover_id: "h-1", business_date: "2026-11-18" },
			update_handover: { handover_id: "h-1", business_date: "2026-11-18" },
			acknowledge_handover: { handover_id: "h-1" },
			report_incident: {
				incident_id: "x-1",
				business_date: "2026-11-18",
				status: "open",
				photo_bucket: "ops-brand-1",
				photo_prefix: `${TENANT}/${STORE}/incident/x-1/`,
			},
			update_incident: { incident_id: "x-1", status: "open", photo_paths: [] },
			acknowledge_incident: { incident_id: "x-1", status: "seen" },
			resolve_incident: { incident_id: "x-1", status: "resolved" },
			incident_categories_of: [
				{ key: "khac", label: "Khác", sort_order: 90, active: true },
			],
			cash_count_review: [],
		});
		const ops = createRestOpsClient(rest, storage, token({ sub: MEMBER }));
		expect(ops.memberId).toBe(MEMBER);
		await ops.dueChecklists(STORE);
		await ops.startChecklistRun("t-1", STORE);
		await ops.saveChecklistAnswer({
			answerId: "a-2",
			done: true,
			numberValue: 4,
			photoPath: null,
		});
		await ops.finishChecklistRun(RUN);
		expect(
			await ops.recordCashCount({
				storeId: STORE,
				amount: 2_500_000,
				denominations: { "500000": 5 },
				note: null,
				replacesId: null,
			}),
		).toEqual({
			cashCountId: "c-1",
			businessDate: "2026-11-18",
			countedAt: "2026-11-18T15:00:00+00:00",
			matched: false,
		});
		await ops.cashCountReview([STORE], "2026-11-17", "2026-11-18");
		await ops.reopenCashCount("c-1");
		await ops.writeHandover({
			storeId: STORE,
			fromShift: 1,
			toShift: 2,
			note: "Ghi chú",
		});
		await ops.updateHandover("h-1", {
			fromShift: 2,
			toShift: 3,
			note: "Ghi chú",
		});
		await ops.acknowledgeHandover("h-1");
		expect(
			await ops.reportIncident({
				storeId: STORE,
				kind: "stock_out",
				categoryKey: "khac",
				description: "Hết từ trưa",
				itemLabel: "Sữa",
			}),
		).toMatchObject({ incidentId: "x-1", photo: { bucket: "ops-brand-1" } });
		await ops.updateIncident({
			incidentId: "x-1",
			categoryKey: "khac",
			description: "Hết từ trưa",
			itemLabel: "Sữa",
			photoPaths: ["p"],
		});
		expect(await ops.acknowledgeIncident("x-1")).toBe("seen");
		expect(await ops.resolveIncident("x-1")).toBe("resolved");
		expect(await ops.incidentCategories(TENANT)).toEqual([
			{ key: "khac", label: "Khác", active: true },
		]);
		expect(calls.map((call) => [call.name, call.args])).toEqual([
			["due_checklists", { p_store_id: STORE }],
			["start_checklist_run", { p_template_id: "t-1", p_store_id: STORE }],
			[
				"save_checklist_answer",
				{
					p_answer_id: "a-2",
					p_done: true,
					p_number_value: 4,
					p_photo_path: null,
				},
			],
			["finish_checklist_run", { p_run_id: RUN }],
			[
				"record_cash_count",
				{
					p_store_id: STORE,
					p_counted_amount: 2_500_000,
					p_denominations: { "500000": 5 },
					p_note: null,
					p_replaces_id: null,
				},
			],
			[
				"cash_count_review",
				{ store_ids: [STORE], from_date: "2026-11-17", to_date: "2026-11-18" },
			],
			["reopen_cash_count", { p_cash_count_id: "c-1" }],
			[
				"write_handover",
				{
					p_store_id: STORE,
					p_from_shift: 1,
					p_to_shift: 2,
					p_note: "Ghi chú",
				},
			],
			[
				"update_handover",
				{
					p_handover_id: "h-1",
					p_from_shift: 2,
					p_to_shift: 3,
					p_note: "Ghi chú",
				},
			],
			["acknowledge_handover", { p_handover_id: "h-1" }],
			[
				"report_incident",
				{
					p_store_id: STORE,
					p_kind: "stock_out",
					p_category_key: "khac",
					p_description: "Hết từ trưa",
					p_item_label: "Sữa",
				},
			],
			[
				"update_incident",
				{
					p_incident_id: "x-1",
					p_category_key: "khac",
					p_description: "Hết từ trưa",
					p_item_label: "Sữa",
					p_photo_paths: ["p"],
				},
			],
			["acknowledge_incident", { p_incident_id: "x-1" }],
			["resolve_incident", { p_incident_id: "x-1" }],
			["incident_categories_of", { p_tenant_id: TENANT }],
		]);
	});

	it("reads open reports and recent handovers of the member's stores only, and asks nothing for no store", async () => {
		const { rest, calls } = fakeRest({
			incidents: [
				{
					id: "x-1",
					store_id: STORE,
					business_date: "2026-11-18",
					occurred_at: "2026-11-18T03:00:00+00:00",
					kind: "incident",
					category_key: "thiet_bi",
					description: "Vòi nước rò rỉ",
					item_label: null,
					photo_bucket: "ops-brand-1",
					photo_paths: [],
					status: "open",
					created_by: MEMBER,
					created_at: "2026-11-18T03:01:00+00:00",
				},
			],
		});
		const ops = createRestOpsClient(rest, storage, "x");
		expect(await ops.incidents([])).toEqual([]);
		expect(await ops.handovers([], "2026-11-17")).toEqual([]);
		expect(calls).toEqual([]);
		expect((await ops.incidents([STORE]))[0]).toMatchObject({
			kind: "incident",
			status: "open",
		});
		await ops.handovers([STORE], "2026-11-17");
		await ops.cashCounts(STORE, "2026-11-17");
		expect(calls.map((call) => [call.name, call.args])).toEqual([
			[
				"incidents",
				expect.objectContaining({
					store_id: `in.(${STORE})`,
					status: "in.(open,seen)",
				}),
			],
			[
				"shift_handovers",
				expect.objectContaining({
					store_id: `in.(${STORE})`,
					business_date: "gte.2026-11-17",
				}),
			],
			[
				"cash_counts",
				expect.objectContaining({
					store_id: `eq.${STORE}`,
					business_date: "gte.2026-11-17",
				}),
			],
		]);
		expect(() => readIncident({ id: "x" })).toThrow();
	});

	it("uploads a photo under the run's prefix with a name the bucket accepts", async () => {
		const { rest } = fakeRest({});
		const ops = createRestOpsClient(rest, storage, "x");
		const path = await ops.uploadPhoto(
			{ bucket: "ops-brand-1", prefix: `${TENANT}/${STORE}/run/${RUN}/` },
			new Blob(["x"]),
		);
		expect(path.startsWith(`${TENANT}/${STORE}/run/${RUN}/`)).toBe(true);
		expect(uploads.at(-1)).toEqual({ bucket: "ops-brand-1", name: path });
		for (let i = 0; i < 50; i += 1) expect(photoName()).toMatch(OPS_PHOTO_NAME);
		expect(photoName(() => 0)).toMatch(/^p-[0-9a-z]+-000000\.jpg$/);
		expect(() =>
			photoPathIn({ bucket: "b", prefix: "a/" }, "../x.jpg"),
		).toThrow();
		expect(photoPathIn({ bucket: "b", prefix: "a" }, "p-1.jpg")).toBe(
			"a/p-1.jpg",
		);
	});

	it("refuses an answer that is null where the function returns an object", async () => {
		const { rest } = fakeRest({});
		const ops = createRestOpsClient(rest, storage, "x");
		await expect(ops.startChecklistRun("t-1", STORE)).rejects.toMatchObject({
			status: 0,
		});
		expect(await ops.checklistRun(RUN)).toBeNull();
	});
});
