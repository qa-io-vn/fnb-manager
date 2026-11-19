import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { writeCodeOf } from "../settings/source";
import {
	ANSWER_SELECT,
	CORRECTION_SELECT,
	chunksOf,
	createSupabaseOperationsSource,
	HANDOVER_SELECT,
	INCIDENT_SELECT,
	ITEM_SELECT,
	RUN_ID_CHUNK,
	RUN_SELECT,
	TEMPLATE_SELECT,
} from "./supabase-operations-source";

const TENANT = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const STAFF_USER = "66666666-6666-4666-8666-666666666666";
const STORE = "77777777-7777-4777-8777-777777777777";
const TEMPLATE = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const AT = "2026-11-17T01:00:00+00:00";

interface Recorded {
	table: string;
	calls: [string, unknown[]][];
}

type Result = { data: unknown; error: unknown };

function fakeClient(answer: (recorded: Recorded) => Result | Error) {
	const log: Recorded[] = [];
	const builder = (table: string) => {
		const recorded: Recorded = { table, calls: [] };
		log.push(recorded);
		const chain = Object.assign(
			Promise.resolve().then(() => {
				const reply = answer(recorded);
				if (reply instanceof Error) throw reply;
				return reply;
			}),
			{},
		) as Promise<Result> & Record<string, unknown>;
		for (const method of [
			"select",
			"eq",
			"in",
			"gte",
			"lte",
			"not",
			"order",
			"range",
		]) {
			chain[method] = (...args: unknown[]) => {
				recorded.calls.push([method, args]);
				return chain;
			};
		}
		return chain;
	};
	const downloads: [string, string][] = [];
	const client = {
		auth: {
			getUser: async () => ({ data: { user: { id: USER } }, error: null }),
		},
		from: builder,
		rpc: (name: string, args: unknown) => {
			const chain = builder(`rpc:${name}`);
			log.at(-1)?.calls.push(["rpc", [args]]);
			return chain;
		},
		storage: {
			from: (bucket: string) => ({
				download: async (path: string) => {
					downloads.push([bucket, path]);
					return path.endsWith("missing.jpg")
						? { data: null, error: { message: "Object not found" } }
						: { data: new Blob(["jpeg"]), error: null };
				},
			}),
		},
	};
	return { client: client as unknown as SupabaseClient, log, downloads };
}

function called(recorded: Recorded | undefined, method: string): unknown[][] {
	return (recorded?.calls ?? [])
		.filter(([name]) => name === method)
		.map(([, args]) => args);
}

function members(recorded: Recorded): Result | null {
	return recorded.table === "tenant_members"
		? {
				data: [
					{ user_id: USER, role: "owner" },
					{ user_id: STAFF_USER, role: "staff" },
				],
				error: null,
			}
		: null;
}

describe("the Supabase operations source", () => {
	it("reads each checklist with the items of its current version only, in order, with its audit line", async () => {
		const { client, log } = fakeClient(
			(recorded) =>
				members(recorded) ??
				(recorded.table === "checklist_templates"
					? {
							data: [
								{
									id: TEMPLATE,
									store_id: null,
									shift_phase: "closing",
									title: "Đóng ca",
									active: true,
									version: 2,
									created_at: AT,
									updated_at: AT,
									updated_by: USER,
								},
							],
							error: null,
						}
					: {
							data: [
								{
									id: "old",
									template_id: TEMPLATE,
									template_version: 1,
									position: 1,
									label: "Cũ",
									requires_photo: false,
									number_unit: null,
								},
								{
									id: "b",
									template_id: TEMPLATE,
									template_version: 2,
									position: 2,
									label: "Tủ",
									requires_photo: false,
									number_unit: "°C",
								},
								{
									id: "a",
									template_id: TEMPLATE,
									template_version: 2,
									position: 1,
									label: "Lau",
									requires_photo: true,
									number_unit: null,
								},
							],
							error: null,
						}),
		);
		const source = createSupabaseOperationsSource(client);
		expect(await source.checklistTemplates(TENANT)).toEqual([
			{
				id: TEMPLATE,
				storeId: null,
				phase: "closing",
				title: "Đóng ca",
				active: true,
				version: 2,
				items: [
					{
						id: "a",
						position: 1,
						label: "Lau",
						requiresPhoto: true,
						numberUnit: null,
					},
					{
						id: "b",
						position: 2,
						label: "Tủ",
						requiresPhoto: false,
						numberUnit: "°C",
					},
				],
				createdAt: AT,
				audit: { changedAt: AT, author: { kind: "you" } },
			},
		]);
		const templates = log.find(
			(entry) => entry.table === "checklist_templates",
		);
		expect(called(templates, "select")).toEqual([[TEMPLATE_SELECT]]);
		expect(called(templates, "eq")).toEqual([["tenant_id", TENANT]]);
		expect(called(templates, "order")).toEqual([["created_at"], ["id"]]);
		expect(called(templates, "range")).toEqual([[0, 999]]);
		const items = log.find((entry) => entry.table === "checklist_items");
		expect(called(items, "select")).toEqual([[ITEM_SELECT]]);
		expect(called(items, "order")).toEqual([
			["template_id"],
			["template_version"],
			["position"],
		]);
	});

	it("saves a checklist through save_checklist_template with the items in order and the store as null for every store", async () => {
		const { client, log } = fakeClient(() => ({
			data: { template_id: TEMPLATE, version: 3, active: true },
			error: null,
		}));
		const source = createSupabaseOperationsSource(client);
		expect(
			await source.saveChecklistTemplate(TENANT, {
				templateId: TEMPLATE,
				storeId: null,
				phase: "opening",
				title: "Mở ca",
				items: [
					{ label: "Lau", requiresPhoto: true, numberUnit: null },
					{ label: "Tủ", requiresPhoto: false, numberUnit: "°C" },
				],
			}),
		).toEqual({ templateId: TEMPLATE, version: 3, active: true });
		expect(called(log[0], "rpc")).toEqual([
			[
				{
					p_tenant_id: TENANT,
					p_store_id: null,
					p_shift_phase: "opening",
					p_title: "Mở ca",
					p_items: [
						{ label: "Lau", requires_photo: true, number_unit: null },
						{ label: "Tủ", requires_photo: false, number_unit: "°C" },
					],
					p_template_id: TEMPLATE,
				},
			],
		]);
		expect(log[0]?.table).toBe("rpc:save_checklist_template");
	});

	it("reports the editor's refusals as forbidden, invalid and network", async () => {
		const refuse = (error: unknown) =>
			createSupabaseOperationsSource(
				fakeClient(() => ({ data: null, error })).client,
			);
		const change = {
			templateId: null,
			storeId: STORE,
			phase: "opening" as const,
			title: "Mở ca",
			items: [{ label: "Lau", requiresPhoto: false, numberUnit: null }],
		};
		await expect(
			refuse({ code: "42501", message: "scope" })
				.saveChecklistTemplate(TENANT, change)
				.catch(writeCodeOf),
		).resolves.toBe("forbidden");
		await expect(
			refuse({ code: "22023", message: "items" })
				.setChecklistTemplateActive(TEMPLATE, false)
				.catch(writeCodeOf),
		).resolves.toBe("invalid");
		const lost = createSupabaseOperationsSource(
			fakeClient(() => new TypeError("Failed to fetch")).client,
		);
		await expect(
			lost.saveChecklistTemplate(TENANT, change).catch(writeCodeOf),
		).resolves.toBe("network");
	});

	it("reads the runs of the stores and dates with their answers, photos and corrections counted per run", async () => {
		const { client, log } = fakeClient((recorded) => {
			if (recorded.table === "checklist_runs") {
				return {
					data: [
						{
							id: RUN,
							store_id: STORE,
							template_id: TEMPLATE,
							template_version: 1,
							title: "Mở ca",
							shift_phase: "opening",
							business_date: "2026-11-17",
							status: "finished",
							started_at: AT,
							finished_at: AT,
							created_by: STAFF_USER,
						},
					],
					error: null,
				};
			}
			if (recorded.table === "checklist_answers") {
				return {
					data: [
						{
							id: "x1",
							run_id: RUN,
							done: true,
							photo_path: "p.jpg",
							photo_removed_at: null,
						},
						{
							id: "x2",
							run_id: RUN,
							done: true,
							photo_path: "q.jpg",
							photo_removed_at: AT,
						},
						{
							id: "x3",
							run_id: RUN,
							done: false,
							photo_path: null,
							photo_removed_at: null,
						},
					],
					error: null,
				};
			}
			return { data: [{ id: "c1", run_id: RUN }], error: null };
		});
		const source = createSupabaseOperationsSource(client);
		expect(
			await source.checklistRuns([STORE], "2026-11-11", "2026-11-17"),
		).toEqual([
			expect.objectContaining({
				id: RUN,
				phase: "opening",
				startedBy: STAFF_USER,
				itemsTotal: 3,
				itemsDone: 2,
				photos: 2,
				photosRemoved: 1,
				corrections: 1,
			}),
		]);
		const runs = log.find((entry) => entry.table === "checklist_runs");
		expect(called(runs, "select")).toEqual([[RUN_SELECT]]);
		expect(called(runs, "in")).toEqual([["store_id", [STORE]]]);
		expect(called(runs, "gte")).toEqual([["business_date", "2026-11-11"]]);
		expect(called(runs, "lte")).toEqual([["business_date", "2026-11-17"]]);
		expect(called(runs, "order")).toEqual([["business_date"], ["id"]]);
		const answers = log.find((entry) => entry.table === "checklist_answers");
		expect(called(answers, "select")).toEqual([[ANSWER_SELECT]]);
		expect(called(answers, "in")).toEqual([["run_id", [RUN]]]);
		expect(called(answers, "order")).toEqual([["run_id"], ["id"]]);
		expect(await source.checklistRuns([], "2026-11-11", "2026-11-17")).toEqual(
			[],
		);
	});

	it("asks for answers in chunks of run ids so a long range stays within the address length", () => {
		const ids = Array.from(
			{ length: RUN_ID_CHUNK * 2 + 1 },
			(_, index) => `${index}`,
		);
		expect(chunksOf(ids, RUN_ID_CHUNK).map((chunk) => chunk.length)).toEqual([
			RUN_ID_CHUNK,
			RUN_ID_CHUNK,
			1,
		]);
	});

	it("reads a run's detail with the wording of its version and the corrections after it finished", async () => {
		const { client, log } = fakeClient((recorded) =>
			recorded.table === "rpc:checklist_run_detail"
				? {
						data: {
							run_id: RUN,
							store_id: STORE,
							title: "Mở ca",
							shift_phase: "opening",
							business_date: "2026-11-17",
							template_version: 1,
							status: "finished",
							started_by: STAFF_USER,
							started_at: AT,
							finished_at: AT,
							photo_bucket: "ops-brand-1",
							items: [
								{
									answer_id: "a1",
									position: 1,
									label: "Lau quầy (bản cũ)",
									requires_photo: true,
									number_unit: null,
									done: true,
									number_value: null,
									photo_path: "t/s/run/r/x.jpg",
									photo_removed: false,
									answered_by: STAFF_USER,
									answered_at: AT,
								},
								{
									answer_id: "a2",
									position: 2,
									label: "Tủ mát",
									requires_photo: false,
									number_unit: "°C",
									done: true,
									number_value: "4.5",
									photo_path: null,
									photo_removed: false,
									answered_by: STAFF_USER,
									answered_at: AT,
								},
							],
						},
						error: null,
					}
				: {
						data: [
							{
								id: "c1",
								answer_id: "a2",
								old_values: { done: true, number_value: 9, photo_path: null },
								new_values: { done: true, number_value: 4.5, photo_path: null },
								created_by: USER,
								created_at: AT,
							},
						],
						error: null,
					},
		);
		const source = createSupabaseOperationsSource(client);
		const detail = await source.runDetail(RUN);
		expect(detail?.items.map((item) => item.label)).toEqual([
			"Lau quầy (bản cũ)",
			"Tủ mát",
		]);
		expect(detail?.items[1]?.numberValue).toBe(4.5);
		expect(detail?.corrections).toEqual([
			{
				id: "c1",
				answerId: "a2",
				before: { done: true, numberValue: 9, photoPath: null },
				after: { done: true, numberValue: 4.5, photoPath: null },
				by: USER,
				at: AT,
			},
		]);
		expect(called(log[0], "rpc")).toEqual([[{ p_run_id: RUN }]]);
		const corrections = log.find(
			(entry) => entry.table === "checklist_corrections",
		);
		expect(called(corrections, "select")).toEqual([[CORRECTION_SELECT]]);
		expect(called(corrections, "eq")).toEqual([["run_id", RUN]]);
		const hidden = createSupabaseOperationsSource(
			fakeClient((recorded) =>
				recorded.table === "rpc:checklist_run_detail"
					? { data: null, error: null }
					: { data: [], error: null },
			).client,
		);
		expect(await hidden.runDetail(RUN)).toBeNull();
	});

	it("downloads a photo as the signed-in member and never builds a link", async () => {
		const { client, downloads } = fakeClient(() => ({ data: [], error: null }));
		const source = createSupabaseOperationsSource(client);
		const blob = await source.photo("ops-brand-1", "t/s/run/r/x.jpg");
		expect(blob).toBeInstanceOf(Blob);
		expect(downloads).toEqual([["ops-brand-1", "t/s/run/r/x.jpg"]]);
		await expect(
			source.photo("ops-brand-1", "t/s/run/r/missing.jpg"),
		).rejects.toThrow("Object not found");
	});

	it("reads cash_count_review with the stores and dates and keeps no POS name or cashier", async () => {
		const { client, log } = fakeClient(() => ({
			data: [
				{
					store_id: STORE,
					business_date: "2026-11-17",
					shift_id: "shift-1",
					shift_number: 2,
					opened_at: AT,
					closed_at: AT,
					cash_count_id: "count-1",
					counted_amount: "1950000.00",
					counted_by: STAFF_USER,
					counted_at: AT,
					recounts: 1,
					expected_cash_amount: "2000000",
					drawer_amount: 2000000,
					cash_sales_amount: 1500000,
					variance_amount: "-50000.00",
					drawer_variance_amount: 0,
					trailing_shifts: 12,
					z_score: null,
					over_abs_threshold: false,
					over_rel_threshold: true,
					over_z_threshold: false,
					reasons: ["relative"],
					state: "over",
				},
			],
			error: null,
		}));
		const source = createSupabaseOperationsSource(client);
		const [row] = await source.cashCounts([STORE], "2026-11-11", "2026-11-17");
		expect(row).toEqual({
			storeId: STORE,
			businessDate: "2026-11-17",
			shiftId: "shift-1",
			shiftNumber: 2,
			openedAt: AT,
			closedAt: AT,
			cashCountId: "count-1",
			countedAmount: 1950000,
			countedBy: STAFF_USER,
			countedAt: AT,
			recounts: 1,
			expectedCashAmount: 2000000,
			drawerAmount: 2000000,
			cashSalesAmount: 1500000,
			varianceAmount: -50000,
			drawerVarianceAmount: 0,
			overAbs: false,
			overRel: true,
			overZ: false,
			state: "over",
		});
		expect(log[0]?.table).toBe("rpc:cash_count_review");
		expect(called(log[0], "rpc")).toEqual([
			[{ store_ids: [STORE], from_date: "2026-11-11", to_date: "2026-11-17" }],
		]);
		const failing = createSupabaseOperationsSource(
			fakeClient(() => ({
				data: null,
				error: { code: "22023", message: "too many rows" },
			})).client,
		);
		await expect(
			failing.cashCounts([STORE], "2026-11-11", "2026-11-17"),
		).rejects.toMatchObject({ code: "22023" });
	});

	it("reads incidents and handovers newest first with a stable order, and the categories through incident_categories_of", async () => {
		const { client, log } = fakeClient((recorded) => {
			if (recorded.table === "rpc:incident_categories_of") {
				return {
					data: [
						{
							key: "khac",
							label: "Khác",
							sort_order: 90,
							active: true,
							tenant_row: false,
						},
					],
					error: null,
				};
			}
			return { data: [], error: null };
		});
		const source = createSupabaseOperationsSource(client);
		await source.incidents([STORE], "2026-11-11", "2026-11-17");
		await source.handovers([STORE], "2026-11-11", "2026-11-17");
		expect(await source.incidentCategories(TENANT)).toEqual([
			{ key: "khac", label: "Khác", sortOrder: 90, active: true },
		]);
		const incidents = log.find((entry) => entry.table === "incidents");
		expect(called(incidents, "select")).toEqual([[INCIDENT_SELECT]]);
		expect(called(incidents, "order")).toEqual([
			["occurred_at", { ascending: false }],
			["id"],
		]);
		const handovers = log.find((entry) => entry.table === "shift_handovers");
		expect(called(handovers, "select")).toEqual([[HANDOVER_SELECT]]);
		expect(called(handovers, "order")).toEqual([
			["created_at", { ascending: false }],
			["id"],
		]);
	});

	it("acknowledges, resolves and reopens through their functions and maps a refusal to forbidden", async () => {
		const { client, log } = fakeClient(() => ({ data: {}, error: null }));
		const source = createSupabaseOperationsSource(client);
		await source.acknowledgeIncident("i1");
		await source.resolveIncident("i1");
		await source.acknowledgeHandover("h1");
		await source.reopenCashCount("c1");
		expect(log.map((entry) => [entry.table, called(entry, "rpc")[0]])).toEqual([
			["rpc:acknowledge_incident", [{ p_incident_id: "i1" }]],
			["rpc:resolve_incident", [{ p_incident_id: "i1" }]],
			["rpc:acknowledge_handover", [{ p_handover_id: "h1" }]],
			["rpc:reopen_cash_count", [{ p_cash_count_id: "c1" }]],
		]);
		const refused = createSupabaseOperationsSource(
			fakeClient(() => ({
				data: null,
				error: { code: "42501", message: "own report" },
			})).client,
		);
		await expect(
			refused.acknowledgeIncident("i1").catch(writeCodeOf),
		).resolves.toBe("forbidden");
	});

	it("names people by their roster name or role and knows the signed-in member", async () => {
		const { client, log } = fakeClient(
			(recorded) =>
				members(recorded) ?? {
					data: [{ user_id: STAFF_USER, display_name: "Nhân viên 1" }],
					error: null,
				},
		);
		const source = createSupabaseOperationsSource(client);
		const actors = await source.actors(TENANT);
		expect(actors.currentUserId).toBe(USER);
		expect(actors.byId.get(USER)).toEqual({ name: null, role: "owner" });
		expect(actors.byId.get(STAFF_USER)).toEqual({
			name: "Nhân viên 1",
			role: "staff",
		});
		const roster = log.find((entry) => entry.table === "staff_roster");
		expect(called(roster, "select")).toEqual([["user_id,display_name"]]);
		expect(called(roster, "not")).toEqual([["user_id", "is", null]]);
	});
});
