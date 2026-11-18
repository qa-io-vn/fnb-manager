import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { localApiUrl } from "./local-loop";
import {
	createPairingFixture,
	localDatabaseUrl,
	type PairingFixture,
} from "./pairing-fixture";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ZALO_PACKAGE = new URL(
	"../../../packages/zalo/package.json",
	import.meta.url,
);
const FIXTURE_PREFIX = "zalo-it-";
const FORBIDDEN_SLUGS: readonly string[] = [
	"live-local",
	"mock-local",
	"demo-fnb",
];
export const EXPECTED_CASH = 2_000_000;

type Row = Record<string, unknown>;

interface Sql {
	<T extends Row = Row>(
		strings: TemplateStringsArray,
		...values: readonly unknown[]
	): Promise<T[]>;
	begin<T>(run: (sql: Sql) => Promise<T>): Promise<T>;
	end(options?: { readonly timeout?: number }): Promise<void>;
}

export const FIRST_ITEMS = [
	{
		label: "Lau quầy và chụp ảnh quầy",
		requires_photo: true,
		number_unit: null,
	},
	{ label: "Nhiệt độ tủ mát", requires_photo: false, number_unit: "°C" },
	{ label: "Đổ rác và thay túi", requires_photo: false, number_unit: null },
];

export const SECOND_ITEMS = [
	{ label: "Kiểm tra máy POS", requires_photo: false, number_unit: null },
	{ label: "Chụp ảnh tủ bánh", requires_photo: true, number_unit: null },
];

export const CHECKLIST_TITLE = "Vệ sinh trong ca";

export interface OpsState {
	readonly runs: number;
	readonly finishedRuns: number;
	readonly runsByStaff: number;
	readonly latestRunVersion: number;
	readonly answersDone: number;
	readonly photoAnswers: number;
	readonly photoObjects: number;
	readonly photoObjectsJpeg: number;
	readonly largestPhotoBytes: number;
	readonly counts: number;
	readonly matchedCounts: number;
	readonly countsByStaff: number;
	readonly handovers: number;
	readonly handoverNoteMatches: boolean;
	readonly incidents: number;
	readonly incidentPhotos: number;
	readonly incidentsSeen: number;
}

export interface OpsFixture extends PairingFixture {
	readonly tenantId: string;
	readonly storeId: string;
	readonly bucket: string;
	readonly templateId: string;
	setVisibility(level: "all" | "store_totals" | "none"): Promise<void>;
	reviseTemplate(): Promise<number>;
	opsState(note: string): Promise<OpsState>;
	staffIncidentId(): Promise<string>;
	storedPhotos(): Promise<Buffer[]>;
	acknowledgeIncident(id: string): Promise<string>;
	ownerCountState(): Promise<{
		readonly state: string;
		readonly variance: number | null;
	}>;
	cleanupOps(): Promise<void>;
}

async function connect(url: string): Promise<Sql> {
	const require = createRequire(ZALO_PACKAGE);
	const loaded = await import(pathToFileURL(require.resolve("postgres")).href);
	const postgres = (loaded.default ?? loaded) as (
		url: string,
		options: Row,
	) => Sql;
	return postgres(url, {
		max: 1,
		connect_timeout: 10,
		onnotice: () => undefined,
	});
}

function secretKey(): string {
	const file = `${ROOT}.env`;
	const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
	return (
		process.env.SUPABASE_SECRET_KEY ||
		fromFile.SUPABASE_SECRET_KEY ||
		""
	).trim();
}

async function removeObjects(
	bucket: string,
	names: readonly string[],
): Promise<boolean> {
	const key = secretKey();
	const api = localApiUrl();
	if (key === "" || api === "" || names.length === 0) return names.length === 0;
	const response = await fetch(`${api}/storage/v1/object/${bucket}`, {
		method: "DELETE",
		headers: {
			apikey: key,
			Authorization: `Bearer ${key}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ prefixes: names }),
	});
	await response.body?.cancel();
	return response.ok;
}

async function dropBucketIfUnused(sql: Sql, bucket: string): Promise<void> {
	const [left] = await sql<{ objects: number; brands: number }>`
		select (select count(*) from storage.objects where bucket_id = ${bucket})::int as objects,
			(select count(*) from public.brands where 'ops-' || brand_key = ${bucket})::int as brands
	`;
	if (left?.objects !== 0 || left.brands !== 0) return;
	await sql.begin(async (tx) => {
		await tx`select set_config('storage.allow_delete_query', 'true', true)`;
		await tx`delete from storage.buckets where id = ${bucket}`;
		return [];
	});
}

export async function createOpsFixture(): Promise<OpsFixture> {
	const url = localDatabaseUrl();
	if (url === "") throw new Error("DATABASE_URL is not the local stack");
	const pairing = await createPairingFixture();
	const sql = await connect(url);
	const fail = async (error: unknown): Promise<never> => {
		try {
			await pairing.cleanup();
			await dropBucketIfUnused(sql, `ops-${pairing.brandKey}`);
		} finally {
			await sql.end({ timeout: 5 });
		}
		throw error;
	};
	const [ids] = await sql<{
		tenant_id: string;
		store_id: string;
		owner_id: string;
	}>`
		select t.id::text as tenant_id,
			(select s.id::text from public.stores s where s.tenant_id = t.id and s.external_id = ${`${pairing.slug}-store-1`}) as store_id,
			(select m.user_id::text from public.tenant_members m where m.tenant_id = t.id and m.role = 'owner' limit 1) as owner_id
		from public.tenants t where t.slug = ${pairing.slug}
	`.catch(fail);
	if (
		ids === undefined ||
		!pairing.slug.startsWith(FIXTURE_PREFIX) ||
		FORBIDDEN_SLUGS.includes(pairing.slug)
	) {
		return fail(new Error("the fixture tenant was not found"));
	}
	const { tenant_id: tenantId, store_id: storeId, owner_id: ownerId } = ids;
	const bucket = `ops-${pairing.brandKey}`;
	const claims = JSON.stringify({ sub: ownerId, role: "authenticated" });
	const asOwner = <T extends Row>(run: (tx: Sql) => Promise<T[]>) =>
		sql.begin(async (tx) => {
			await tx`select set_config('request.jwt.claims', ${claims}, true)`;
			await tx`set local role authenticated`;
			const [row] = await run(tx);
			return row;
		});
	const allDay = JSON.stringify(
		Object.fromEntries(
			["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
				day,
				[["00:00", "24:00"]],
			]),
		),
	);
	let templateId = "";
	try {
		await sql`
			update public.stores set opening_hours = ${allDay}::text::jsonb, timezone = 'Asia/Ho_Chi_Minh'
			where id = ${storeId}::uuid and tenant_id = ${tenantId}::uuid
		`;
		const saved = await asOwner<{ template: { template_id: string } }>(
			(tx) => tx`
				select public.save_checklist_template(${tenantId}::uuid, ${storeId}::uuid, 'midshift',
					${CHECKLIST_TITLE}, ${JSON.stringify(FIRST_ITEMS)}::text::jsonb) as template
			`,
		);
		templateId = saved?.template.template_id ?? "";
		const [shift] = await sql<{ id: string }>`
			insert into public.shifts (tenant_id, store_id, external_id, opened_at, closed_at, sales_amount, orders_count,
				cash_drawer_amount, opening_float_amount, expected_cash_amount)
			values (${tenantId}::uuid, ${storeId}::uuid, ${`${pairing.slug}-shift-1`}, now() - interval '3 hours',
				now() - interval '5 minutes', 3000000, 30, ${EXPECTED_CASH}, 500000, ${EXPECTED_CASH})
			returning id::text as id
		`;
		await sql`
			insert into public.agg_shift_cash (tenant_id, store_id, shift_id, shift_external_id, business_date, opened_at,
				closed_at, orders, sales_amount, cash_sales_amount, opening_float_amount, expected_cash_amount, drawer_amount,
				variance_amount)
			select s.tenant_id, s.store_id, s.id, s.external_id, app.store_business_date(s.store_id, s.opened_at), s.opened_at,
				s.closed_at, s.orders_count, s.sales_amount, 1500000, s.opening_float_amount, s.expected_cash_amount,
				s.cash_drawer_amount, 0
			from public.shifts s where s.id = ${shift?.id ?? ""}::uuid
		`;
	} catch (error) {
		return fail(error);
	}
	const objectNames = async () =>
		(
			await sql<{ name: string }>`
				select name from storage.objects where bucket_id = ${bucket} and name like ${`${tenantId}/%`}
			`
		).map((row) => row.name);
	return {
		...pairing,
		tenantId,
		storeId,
		bucket,
		templateId,
		async setVisibility(level) {
			await sql`update public.tenants set staff_revenue_visibility = ${level} where id = ${tenantId}::uuid`;
		},
		async reviseTemplate() {
			const saved = await asOwner<{ template: { version: number } }>(
				(tx) => tx`
					select public.save_checklist_template(${tenantId}::uuid, ${storeId}::uuid, 'midshift',
						${CHECKLIST_TITLE}, ${JSON.stringify(SECOND_ITEMS)}::text::jsonb, ${templateId}::uuid) as template
				`,
			);
			return Number(saved?.template.version ?? 0);
		},
		async opsState(note) {
			const [row] = await sql<Row>`
				with staff as (
					select r.user_id from public.staff_roster r where r.tenant_id = ${tenantId}::uuid and r.user_id is not null
				)
				select
					(select count(*) from public.checklist_runs r where r.tenant_id = ${tenantId}::uuid)::int as runs,
					(select count(*) from public.checklist_runs r where r.tenant_id = ${tenantId}::uuid and r.status = 'finished' and r.finished_at is not null)::int as finished_runs,
					(select count(*) from public.checklist_runs r where r.tenant_id = ${tenantId}::uuid and r.created_by in (select user_id from staff))::int as runs_by_staff,
					coalesce((select r.template_version from public.checklist_runs r where r.tenant_id = ${tenantId}::uuid order by r.started_at desc limit 1), 0)::int as latest_run_version,
					(select count(*) from public.checklist_answers a where a.tenant_id = ${tenantId}::uuid and a.done)::int as answers_done,
					(select count(*) from public.checklist_answers a where a.tenant_id = ${tenantId}::uuid and a.photo_path is not null)::int as photo_answers,
					(select count(*) from storage.objects o where o.bucket_id = ${bucket} and o.name like ${`${tenantId}/%`})::int as photo_objects,
					(select count(*) from storage.objects o where o.bucket_id = ${bucket} and o.name like ${`${tenantId}/%`} and o.metadata ->> 'mimetype' = 'image/jpeg')::int as photo_objects_jpeg,
					coalesce((select max((o.metadata ->> 'size')::bigint) from storage.objects o where o.bucket_id = ${bucket} and o.name like ${`${tenantId}/%`}), 0)::bigint as largest_photo_bytes,
					(select count(*) from public.cash_counts c where c.tenant_id = ${tenantId}::uuid)::int as counts,
					(select count(*) from public.cash_counts c where c.tenant_id = ${tenantId}::uuid and c.shift_id is not null)::int as matched_counts,
					(select count(*) from public.cash_counts c where c.tenant_id = ${tenantId}::uuid and c.created_by in (select user_id from staff))::int as counts_by_staff,
					(select count(*) from public.shift_handovers h where h.tenant_id = ${tenantId}::uuid)::int as handovers,
					exists (select 1 from public.shift_handovers h where h.tenant_id = ${tenantId}::uuid and h.note = ${note}) as handover_note_matches,
					(select count(*) from public.incidents i where i.tenant_id = ${tenantId}::uuid)::int as incidents,
					coalesce((select sum(cardinality(i.photo_paths)) from public.incidents i where i.tenant_id = ${tenantId}::uuid), 0)::int as incident_photos,
					(select count(*) from public.incidents i where i.tenant_id = ${tenantId}::uuid and i.status = 'seen')::int as incidents_seen
			`;
			return {
				runs: Number(row?.runs ?? 0),
				finishedRuns: Number(row?.finished_runs ?? 0),
				runsByStaff: Number(row?.runs_by_staff ?? 0),
				latestRunVersion: Number(row?.latest_run_version ?? 0),
				answersDone: Number(row?.answers_done ?? 0),
				photoAnswers: Number(row?.photo_answers ?? 0),
				photoObjects: Number(row?.photo_objects ?? 0),
				photoObjectsJpeg: Number(row?.photo_objects_jpeg ?? 0),
				largestPhotoBytes: Number(row?.largest_photo_bytes ?? 0),
				counts: Number(row?.counts ?? 0),
				matchedCounts: Number(row?.matched_counts ?? 0),
				countsByStaff: Number(row?.counts_by_staff ?? 0),
				handovers: Number(row?.handovers ?? 0),
				handoverNoteMatches: row?.handover_note_matches === true,
				incidents: Number(row?.incidents ?? 0),
				incidentPhotos: Number(row?.incident_photos ?? 0),
				incidentsSeen: Number(row?.incidents_seen ?? 0),
			};
		},
		async storedPhotos() {
			const key = secretKey();
			const api = localApiUrl();
			if (key === "" || api === "") return [];
			const photos: Buffer[] = [];
			for (const name of await objectNames()) {
				const response = await fetch(
					`${api}/storage/v1/object/${bucket}/${name.split("/").map(encodeURIComponent).join("/")}`,
					{ headers: { apikey: key, Authorization: `Bearer ${key}` } },
				);
				if (!response.ok) {
					await response.body?.cancel();
					throw new Error(
						`a stored photo could not be read: ${response.status}`,
					);
				}
				photos.push(Buffer.from(await response.arrayBuffer()));
			}
			return photos;
		},
		async staffIncidentId() {
			const [row] = await sql<{ id: string }>`
				select i.id::text as id from public.incidents i where i.tenant_id = ${tenantId}::uuid
				order by i.created_at desc limit 1
			`;
			return row?.id ?? "";
		},
		async acknowledgeIncident(id) {
			const row = await asOwner<{ answer: { status: string } }>(
				(tx) => tx`select public.acknowledge_incident(${id}::uuid) as answer`,
			);
			return String(row?.answer.status ?? "");
		},
		async ownerCountState() {
			const row = await asOwner<{ state: string; variance: string | null }>(
				(tx) => tx`
					select r.state, r.variance_amount::text as variance
					from public.cash_count_review(array[${storeId}::uuid], current_date - 1, current_date + 1) r
					where r.cash_count_id is not null
					order by r.counted_at desc limit 1
				`,
			);
			return {
				state: String(row?.state ?? ""),
				variance:
					row?.variance === null || row?.variance === undefined
						? null
						: Number(row.variance),
			};
		},
		async cleanupOps() {
			try {
				const names = await objectNames();
				if (!(await removeObjects(bucket, names)) && names.length > 0) {
					await sql.begin(async (tx) => {
						await tx`select set_config('storage.allow_delete_query', 'true', true)`;
						await tx`delete from storage.objects where bucket_id = ${bucket} and name like ${`${tenantId}/%`}`;
						return [];
					});
				}
			} finally {
				await pairing.cleanup();
				try {
					await dropBucketIfUnused(sql, bucket);
				} finally {
					await sql.end({ timeout: 5 });
				}
			}
		},
	};
}
