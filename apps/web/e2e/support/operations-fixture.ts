import type { SupabaseClient } from "@supabase/supabase-js";
import {
	FIXTURE_SLUG_PREFIX,
	openFixtureDatabase,
	type SettingsFixture,
} from "./settings-fixture";

export const OPS_BRAND_KEY = "brand-908";
export const OPS_BUCKET = `ops-${OPS_BRAND_KEY}`;
export const POS_SHIFT_NAMES = ["Ca sáng POS", "Ca chiều POS", "Ca tối POS"];
export const POS_CASHIER = "thu-ngan-e2e@example.com";

export const TEMPLATE_TITLES = {
	opening: "Mở ca E2E",
	midshift: "Giữa ca E2E",
	closing: "Đóng ca E2E",
} as const;

export const OPENING_ITEMS = [
	{ label: "Mở ca trên POS", requires_photo: false, number_unit: null },
	{ label: "Lau quầy", requires_photo: true, number_unit: null },
	{ label: "Nhiệt độ tủ mát", requires_photo: false, number_unit: "°C" },
] as const;

const MIDSHIFT_ITEMS = [
	{ label: "Vệ sinh bàn khách", requires_photo: false, number_unit: null },
	{ label: "Báo sự cố nếu có", requires_photo: false, number_unit: null },
] as const;

const CLOSING_ITEMS = [
	{ label: "Kiểm đếm hàng hủy", requires_photo: false, number_unit: "phần" },
	{ label: "Đóng ca trên POS", requires_photo: false, number_unit: null },
] as const;

export const COUNTS = {
	within: 2_000_000,
	over: 1_380_000,
} as const;

export const TEXTS = {
	incident: "Máy xay kêu to, đã tắt máy",
	stockOut: "Hết trân châu đen từ chiều",
	stockOutItem: "Trân châu đen",
	otherStore: "Sàn kho bị ướt",
	handover: "Máy xay đã báo thợ; còn nửa thùng sữa",
} as const;

export interface OperationsFixture {
	readonly bucket: string;
	readonly day: string;
	readonly countDay: string;
	readonly templates: Readonly<Record<keyof typeof TEMPLATE_TITLES, string>>;
	readonly openingRunId: string;
	readonly midshiftRunId: string;
	readonly runPhotoPath: string;
	readonly incidentId: string;
	readonly incidentPhotoPath: string;
	readonly stockOutId: string;
	readonly otherStoreIncidentId: string;
	readonly handoverId: string;
	readonly countIds: { readonly within: string; readonly over: string };
	readonly shiftIds: readonly [string, string, string];
}

interface RunDetail {
	readonly run_id: string;
	readonly photo_bucket: string | null;
	readonly photo_prefix: string | null;
	readonly business_date: string;
	readonly items: readonly {
		readonly answer_id: string;
		readonly position: number;
	}[];
}

function fixtureHex(fixture: SettingsFixture): string {
	if (!fixture.slug.startsWith(FIXTURE_SLUG_PREFIX)) {
		throw new Error(
			"the operations fixture writes only to a settings fixture tenant",
		);
	}
	return fixture.slug.slice(FIXTURE_SLUG_PREFIX.length);
}

async function rpc<T>(
	client: SupabaseClient,
	name: string,
	args: Record<string, unknown>,
): Promise<T> {
	const { data, error } = await client.rpc(name, args);
	if (error) throw new Error(`${name}: ${error.code} ${error.message}`);
	return data as T;
}

async function upload(
	client: SupabaseClient,
	bucket: string,
	path: string,
	jpeg: Buffer,
): Promise<void> {
	const { error } = await client.storage
		.from(bucket)
		.upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
	if (error) throw new Error(`upload ${path}: ${error.message}`);
}

function pause(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function createOperationsFixture(
	fixture: SettingsFixture,
	jpeg: Buffer,
): Promise<OperationsFixture> {
	fixtureHex(fixture);
	const [storeOne, storeTwo] = fixture.storeIds;
	const sql = openFixtureDatabase();
	try {
		await sql.begin(async (tx) => {
			await tx`
				insert into public.brands (tenant_id, brand_key, display_name, store_ids, created_by)
				values (${fixture.tenantId}, ${OPS_BRAND_KEY}, 'Thương hiệu vận hành thử', ${[...fixture.storeIds]}::uuid[], ${fixture.logins.owner.userId})
			`;
			await tx`
				update public.stores s
				set business_day_start_minutes = (
						(extract(hour from now() at time zone s.timezone) * 60
							+ extract(minute from now() at time zone s.timezone))::integer - 60 + 1440
					) % 1440,
					opening_hours = null
				where s.id = ${storeOne}
			`;
		});
		const owner = await fixture.clientAs("owner");
		const staff = await fixture.clientAs("staff");
		try {
			const save = async (
				phase: string,
				title: string,
				items: readonly unknown[],
			) =>
				(
					await rpc<{ template_id: string }>(owner, "save_checklist_template", {
						p_tenant_id: fixture.tenantId,
						p_store_id: storeOne,
						p_shift_phase: phase,
						p_title: title,
						p_items: items,
					})
				).template_id;
			const templates = {
				opening: await save("opening", TEMPLATE_TITLES.opening, OPENING_ITEMS),
				midshift: await save(
					"midshift",
					TEMPLATE_TITLES.midshift,
					MIDSHIFT_ITEMS,
				),
				closing: await save("closing", TEMPLATE_TITLES.closing, CLOSING_ITEMS),
			};
			await sql`
				update public.checklist_templates
				set created_at = now() - interval '3 days'
				where tenant_id = ${fixture.tenantId}
			`;

			const within = await rpc<{ cash_count_id: string; counted_at: string }>(
				staff,
				"record_cash_count",
				{ p_store_id: storeOne, p_counted_amount: COUNTS.within },
			);
			await pause(1_100);
			const over = await rpc<{ cash_count_id: string; counted_at: string }>(
				staff,
				"record_cash_count",
				{ p_store_id: storeOne, p_counted_amount: COUNTS.over },
			);
			const hex = fixtureHex(fixture);
			const shifts = await sql.begin(async (tx) => {
				const made = await tx<{ id: string }[]>`
					insert into public.shifts (
						tenant_id, store_id, external_id, name, cashier_external_id, cashier_name,
						opened_at, closed_at, sales_amount, orders_count, cash_drawer_amount,
						opening_float_amount, expected_cash_amount
					)
					values
						(${fixture.tenantId}, ${storeOne}, ${`e2e-ops-${hex}-1`}, ${POS_SHIFT_NAMES[0] ?? ""}, 'cashier-e2e', ${POS_CASHIER},
							${within.counted_at}::timestamptz - interval '5 hours', ${within.counted_at}::timestamptz - interval '3 hours',
							900000, 12, 1200000, 500000, 1200000),
						(${fixture.tenantId}, ${storeOne}, ${`e2e-ops-${hex}-2`}, ${POS_SHIFT_NAMES[1] ?? ""}, 'cashier-e2e', ${POS_CASHIER},
							${within.counted_at}::timestamptz - interval '3 hours', ${within.counted_at}::timestamptz,
							1500000, 20, 2000000, 500000, 2000000),
						(${fixture.tenantId}, ${storeOne}, ${`e2e-ops-${hex}-3`}, ${POS_SHIFT_NAMES[2] ?? ""}, 'cashier-e2e', ${POS_CASHIER},
							${within.counted_at}::timestamptz - interval '2 hours', ${over.counted_at}::timestamptz,
							1100000, 15, 1480000, 500000, 1500000)
					returning id
				`;
				const [day] = await tx<{ day: string }[]>`
					select app.store_business_date(${storeOne}::uuid, ${within.counted_at}::timestamptz - interval '3 hours')::text as day
				`;
				if (day === undefined) throw new Error("no business date");
				await tx`select app.refresh_analytics(${fixture.tenantId}::uuid, ${day.day}::date, ${day.day}::date)`;
				return made.map((row) => row.id);
			});
			const [shiftOne, shiftTwo, shiftThree] = shifts;
			if (
				shiftOne === undefined ||
				shiftTwo === undefined ||
				shiftThree === undefined
			) {
				throw new Error("the three shifts were not made");
			}
			const matched = await sql<{ id: string; shift_id: string | null }[]>`
				select id, shift_id from public.cash_counts
				where id in ${sql([within.cash_count_id, over.cash_count_id])}
			`;
			const shiftOf = (id: string) =>
				matched.find((row) => row.id === id)?.shift_id ?? null;
			if (
				shiftOf(within.cash_count_id) !== shiftTwo ||
				shiftOf(over.cash_count_id) !== shiftThree
			) {
				throw new Error("the fixture's counts did not match their shifts");
			}
			const [countDay] = await sql<{ day: string }[]>`
				select business_date::text as day from public.cash_counts where id = ${within.cash_count_id}
			`;

			const opening = await rpc<RunDetail>(staff, "start_checklist_run", {
				p_template_id: templates.opening,
				p_store_id: storeOne,
			});
			if (
				opening.photo_bucket !== OPS_BUCKET ||
				opening.photo_prefix === null
			) {
				throw new Error("the run has no photo bucket");
			}
			const runPhotoPath = `${opening.photo_prefix}lau-quay.jpg`;
			await upload(staff, OPS_BUCKET, runPhotoPath, jpeg);
			const answer = (position: number) => {
				const item = opening.items.find((entry) => entry.position === position);
				if (item === undefined) throw new Error(`no item ${position}`);
				return item.answer_id;
			};
			await rpc(staff, "save_checklist_answer", {
				p_answer_id: answer(1),
				p_done: true,
			});
			await rpc(staff, "save_checklist_answer", {
				p_answer_id: answer(2),
				p_done: true,
				p_photo_path: runPhotoPath,
			});
			await rpc(staff, "save_checklist_answer", {
				p_answer_id: answer(3),
				p_done: true,
				p_number_value: 9,
			});
			await rpc(staff, "finish_checklist_run", { p_run_id: opening.run_id });
			await rpc(owner, "save_checklist_answer", {
				p_answer_id: answer(3),
				p_done: true,
				p_number_value: 4.5,
			});
			const midshift = await rpc<RunDetail>(staff, "start_checklist_run", {
				p_template_id: templates.midshift,
				p_store_id: storeOne,
			});
			const firstMid = midshift.items.find((entry) => entry.position === 1);
			if (firstMid === undefined) throw new Error("no mid-shift item");
			await rpc(staff, "save_checklist_answer", {
				p_answer_id: firstMid.answer_id,
				p_done: true,
			});

			const incident = await rpc<{ incident_id: string; photo_prefix: string }>(
				staff,
				"report_incident",
				{
					p_store_id: storeOne,
					p_kind: "incident",
					p_category_key: "thiet_bi",
					p_description: TEXTS.incident,
				},
			);
			const incidentPhotoPath = `${incident.photo_prefix}may-xay.jpg`;
			await upload(staff, OPS_BUCKET, incidentPhotoPath, jpeg);
			await rpc(staff, "update_incident", {
				p_incident_id: incident.incident_id,
				p_category_key: "thiet_bi",
				p_description: TEXTS.incident,
				p_item_label: null,
				p_photo_paths: [incidentPhotoPath],
			});
			const stockOut = await rpc<{ incident_id: string }>(
				staff,
				"report_incident",
				{
					p_store_id: storeOne,
					p_kind: "stock_out",
					p_category_key: "khac",
					p_description: TEXTS.stockOut,
					p_item_label: TEXTS.stockOutItem,
				},
			);
			const otherStore = await rpc<{ incident_id: string }>(
				staff,
				"report_incident",
				{
					p_store_id: storeTwo,
					p_kind: "incident",
					p_category_key: "ve_sinh",
					p_description: TEXTS.otherStore,
				},
			);
			const handover = await rpc<{ handover_id: string }>(
				staff,
				"write_handover",
				{
					p_store_id: storeOne,
					p_from_shift: 1,
					p_to_shift: 2,
					p_note: TEXTS.handover,
				},
			);
			return {
				bucket: OPS_BUCKET,
				day: opening.business_date,
				countDay: countDay?.day ?? "",
				templates,
				openingRunId: opening.run_id,
				midshiftRunId: midshift.run_id,
				runPhotoPath,
				incidentId: incident.incident_id,
				incidentPhotoPath,
				stockOutId: stockOut.incident_id,
				otherStoreIncidentId: otherStore.incident_id,
				handoverId: handover.handover_id,
				countIds: { within: within.cash_count_id, over: over.cash_count_id },
				shiftIds: [shiftOne, shiftTwo, shiftThree],
			};
		} finally {
			await owner.auth.signOut();
			await staff.auth.signOut();
		}
	} finally {
		await sql.end();
	}
}

export async function jpegFromBrowser(
	page: import("@playwright/test").Page,
): Promise<Buffer> {
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 48;
		canvas.height = 32;
		const context = canvas.getContext("2d");
		if (context === null) throw new Error("no canvas");
		context.fillStyle = "#4d7c8a";
		context.fillRect(0, 0, 48, 32);
		context.fillStyle = "#f2c14e";
		context.fillRect(8, 8, 32, 16);
		return canvas.toDataURL("image/jpeg", 0.8);
	});
	return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}
