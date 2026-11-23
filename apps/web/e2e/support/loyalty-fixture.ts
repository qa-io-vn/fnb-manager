import {
	FIXTURE_SLUG_PREFIX,
	openFixtureDatabase,
	type SettingsFixture,
} from "./settings-fixture";

export const COUNTRY = "+84";

export function syntheticPhone(tail: string): string {
	return `${COUNTRY}90000${tail}`;
}

export const LOYALTY_PHONES = {
	main: syntheticPhone("1201"),
	second: syntheticPhone("1202"),
	staff: syntheticPhone("1203"),
} as const;

export const PROGRAMME_NAME = "Tích dấu thử E2E";
export const BULK_MEMBERS = 110;
export const STAMP_MIN_BILL = 30_000;
export const ADJUSTMENT_REASON = "Bù dấu do máy in lỗi";
export const QUEUE_AMOUNT = 45_000;

export const RECONCILIATION_ENTRY_NAME = "Giảm thành viên 10%";
export const RECONCILIATION_BILL_DISCOUNT = "Giảm tay";

export interface LoyaltyFixture {
	readonly programmeId: string;
	readonly day: string;
	readonly members: {
		readonly main: string;
		readonly second: string;
		readonly staff: string;
	};
	readonly memberCount: number;
	readonly queueItemId: string;
	readonly queueInvoices: readonly [string, string];
	/** The path D items (G-100): one of each reason, and the code of the redemption behind two of them. */
	readonly reconciliation: {
		readonly itemIds: readonly [string, string, string];
		readonly redemptionCode: string;
		readonly entryName: string;
		readonly billDiscountName: string;
	};
	readonly shiftIds: readonly [string, string];
	readonly earnedOnDay: number;
}

function fixtureHex(fixture: SettingsFixture): string {
	if (!fixture.slug.startsWith(FIXTURE_SLUG_PREFIX)) {
		throw new Error(
			"the loyalty fixture writes only to a settings fixture tenant",
		);
	}
	return fixture.slug.slice(FIXTURE_SLUG_PREFIX.length);
}

export async function createLoyaltyFixture(
	fixture: SettingsFixture,
): Promise<LoyaltyFixture> {
	const hex = fixtureHex(fixture);
	const [storeOne, storeTwo] = fixture.storeIds;
	const tenantId = fixture.tenantId;
	const owner = fixture.logins.owner.userId;
	const day = fixture.sales.to;
	const sql = openFixtureDatabase();
	try {
		return await sql.begin(async (tx) => {
			const local = async (time: string): Promise<string> => {
				const [row] = await tx<{ at: string }[]>`
					select ((${day}::date + ${time}::time) at time zone 'Asia/Ho_Chi_Minh')::text as at
				`;
				if (row === undefined) throw new Error("no local time");
				return row.at;
			};
			const [programme] = await tx<{ id: string }[]>`
				insert into public.loyalty_programmes (
					tenant_id, name, starts_on, status, notification_decision,
					stamp_min_bill_amount, created_by
				)
				values (
					${tenantId}, ${PROGRAMME_NAME}, ${day}::date - 30, 'active', 'below_threshold',
					${STAMP_MIN_BILL}, ${owner}
				)
				returning id
			`;
			if (programme === undefined) throw new Error("no programme");
			await tx`
				insert into public.loyalty_staff_phones (tenant_id, phone, label, created_by)
				values (${tenantId}, ${LOYALTY_PHONES.staff}, 'Thu ngân', ${owner})
			`;
			const joinedAt = await local("06:00");
			const join = async (
				phone: string,
				channel: string,
				storeId: string,
				minutesBefore: number,
			): Promise<string> => {
				const [row] = await tx<{ id: string }[]>`
					select app.loyalty_join(
						${tenantId}::uuid,
						app.loyalty_customer_for_phone(${tenantId}::uuid, ${phone}, ${joinedAt}::timestamptz),
						${channel},
						${storeId}::uuid,
						null,
						null,
						${joinedAt}::timestamptz - make_interval(mins => ${minutesBefore}::integer)
					) as id
				`;
				if (row?.id === undefined)
					throw new Error(`no membership for ${channel}`);
				return row.id;
			};
			const members = {
				main: await join(LOYALTY_PHONES.main, "mini_app", storeOne, 2),
				second: await join(LOYALTY_PHONES.second, "till", storeTwo, 1),
				staff: await join(LOYALTY_PHONES.staff, "staff", storeOne, 0),
			};
			await tx`
				with made as (
					insert into public.customers (tenant_id, phone, first_seen_at, last_seen_at)
					select ${tenantId}, '+84' || (900020000 + g)::text, now(), now()
					from generate_series(1, ${BULK_MEMBERS}::integer) g
					returning id, phone
				)
				insert into public.memberships (tenant_id, programme_id, customer_id, joined_at, channel)
				select ${tenantId}, ${programme.id}, m.id,
					${joinedAt}::timestamptz - interval '20 days' + right(m.phone, 4)::integer * interval '1 minute',
					'import'
				from made m
			`;
			const shifts = await tx<{ id: string }[]>`
				insert into public.shifts (tenant_id, store_id, external_id, name, opened_at, closed_at)
				values
					(${tenantId}, ${storeOne}, ${`e2e-loy-${hex}-1`}, 'Ca POS sáng', ${await local("07:00")}::timestamptz, ${await local("12:00")}::timestamptz),
					(${tenantId}, ${storeOne}, ${`e2e-loy-${hex}-2`}, 'Ca POS tối', ${await local("12:00")}::timestamptz, ${await local("23:00")}::timestamptz)
				returning id
			`;
			const [shiftOne, shiftTwo] = shifts.map((row) => row.id);
			if (shiftOne === undefined || shiftTwo === undefined) {
				throw new Error("no shifts");
			}
			const storeOneSales = await tx<{ id: string; sold_at: string }[]>`
				select id, sold_at::text from public.invoices
				where store_id = ${storeOne} and business_date = ${day}::date
				order by sold_at, external_id
			`;
			const [storeTwoSale] = await tx<{ id: string; sold_at: string }[]>`
				select id, sold_at::text from public.invoices
				where store_id = ${storeTwo} and business_date = ${day}::date
				order by sold_at, external_id
				limit 1
			`;
			if (storeOneSales.length < 6 || storeTwoSale === undefined) {
				throw new Error(
					"the settings fixture has too few sales on its last day",
				);
			}
			const earn = async (
				invoiceId: string,
				membershipId: string,
				path: string,
				soldAt: string,
			) => {
				await tx`
					select * from app.loyalty_earn(
						${invoiceId}::uuid, ${membershipId}::uuid, ${path},
						${soldAt}::timestamptz + interval '1 hour'
					)
				`;
			};
			for (const sale of storeOneSales.slice(0, 4)) {
				await earn(sale.id, members.main, "A", sale.sold_at);
			}
			const staffSale = storeOneSales[4];
			if (staffSale !== undefined) {
				await earn(staffSale.id, members.staff, "A", staffSale.sold_at);
			}
			await earn(storeTwoSale.id, members.second, "C", storeTwoSale.sold_at);
			const adjustedAt = await local("13:00");
			await tx`
				insert into public.loyalty_ledger (
					tenant_id, programme_id, membership_id, store_id, entry_kind,
					stamp_delta, reason, approved_by, business_date, occurred_at
				)
				values (
					${tenantId}, ${programme.id}, ${members.main}, ${storeOne}, 'adjust',
					1, ${ADJUSTMENT_REASON}, ${owner}, ${day}::date, ${adjustedAt}::timestamptz
				)
			`;
			const queueAt = await local("20:00");
			const queued = await tx<{ id: string }[]>`
				insert into public.invoices (
					tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date,
					gross_amount, net_amount, paid_amount
				)
				values
					(${tenantId}, ${storeOne}, ${fixture.accountId}, ${`E2E-Q-${hex}-1`}, 'Q1',
						${queueAt}::timestamptz, ${day}::date, ${QUEUE_AMOUNT}, ${QUEUE_AMOUNT}, ${QUEUE_AMOUNT}),
					(${tenantId}, ${storeOne}, ${fixture.accountId}, ${`E2E-Q-${hex}-2`}, 'Q2',
						${queueAt}::timestamptz + interval '1 minute', ${day}::date, ${QUEUE_AMOUNT}, ${QUEUE_AMOUNT}, ${QUEUE_AMOUNT})
				returning id
			`;
			const [queuedOne, queuedTwo] = queued.map((row) => row.id);
			if (queuedOne === undefined || queuedTwo === undefined) {
				throw new Error("no queue invoices");
			}
			const checkIn = async (
				membershipId: string,
				at: string,
			): Promise<string> => {
				const [code] = await tx<{ code: string }[]>`
					select c.code from app.loyalty_issue_checkin_code(
						${membershipId}::uuid, ${storeOne}::uuid, ${at}::timestamptz - interval '30 seconds'
					) c
				`;
				if (code === undefined) throw new Error("no check-in code");
				const [recorded] = await tx<{ id: string }[]>`
					select app.loyalty_record_checkin(
						${storeOne}::uuid, ${code.code}, ${fixture.logins.staff.userId}::uuid, null,
						${at}::timestamptz + interval '15 seconds'
					) as id
				`;
				if (recorded === undefined) throw new Error("no recorded check-in");
				return recorded.id;
			};
			const queuedCheckin = await checkIn(members.second, queueAt);
			await checkIn(members.main, await local("22:00"));
			const [item] = await tx<{ id: string }[]>`
				select id from public.loyalty_queue where checkin_id = ${queuedCheckin}
			`;
			if (item === undefined) {
				throw new Error(
					"the double-candidate check-in did not reach the queue",
				);
			}
			// Path D items as app.reconcile_redemptions writes them (G-100): a verified redemption with no invoice, a bill
			// discount with no redemption, and a redemption whose invoice carries another amount. The redemption's code must
			// never reach the page.
			await tx`select set_config('request.jwt.claims', '', true)`;
			const [coupon] = await tx<{ id: string }[]>`
				insert into public.coupons (
					tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, reward_amount,
					reward_item_external_ids, excluded_item_external_ids, min_bill_amount, cost_points, status
				)
				values (
					${tenantId}, ${programme.id}, ${`e2e-d-${hex}`}, 'Giảm 10%', 'percent_off', 10, null,
					null, '{}', 0, 10, 'draft'
				)
				returning id
			`;
			if (coupon === undefined) throw new Error("no coupon");
			const redemptionCode = `D${hex.toUpperCase()}`.slice(0, 12);
			const [redemption] = await tx<{ id: string }[]>`
				insert into public.redemptions (
					tenant_id, store_id, membership_id, coupon_id, code, state, held_at, hold_expires_at,
					verified_at, rail, pos_discount_name
				)
				values (
					${tenantId}, ${storeOne}, ${members.main}, ${coupon.id}, ${redemptionCode}, 'held',
					now() - interval '4 days', now() - interval '3 days', now() - interval '4 days',
					'pos_payment_discount', ${RECONCILIATION_ENTRY_NAME}
				)
				returning id
			`;
			if (redemption === undefined) throw new Error("no redemption");
			await tx`
				update public.invoices set bill_discount_name = ${RECONCILIATION_BILL_DISCOUNT} where id = ${queuedOne}
			`;
			const reconciliation = await tx<{ id: string; reason: string }[]>`
				insert into public.loyalty_queue (
					tenant_id, store_id, membership_id, redemption_id, invoice_id, matched_path, candidate_invoice_ids, reason, created_at
				)
				values
					(${tenantId}, ${storeOne}, ${members.main}, ${redemption.id}, null, 'D', '{}', 'verified_without_invoice', now() - interval '3 days'),
					(${tenantId}, ${storeOne}, ${members.main}, ${redemption.id}, ${queuedTwo}, 'D', '{}', 'amount_mismatch', now() - interval '2 days'),
					(${tenantId}, ${storeOne}, null, null, ${queuedOne}, 'D', '{}', 'discount_without_redemption', now() - interval '1 day')
				returning id, reason
			`;
			const itemIdOf = (reason: string): string => {
				const found = reconciliation.find((row) => row.reason === reason);
				if (found === undefined)
					throw new Error(`no path D item for ${reason}`);
				return found.id;
			};
			const [count] = await tx<{ members: number; earned: number }[]>`
				select
					(select count(*)::int from public.memberships where tenant_id = ${tenantId}) as members,
					(select count(*)::int from public.loyalty_ledger
						where tenant_id = ${tenantId} and entry_kind = 'earn' and business_date = ${day}::date) as earned
			`;
			return {
				programmeId: programme.id,
				day,
				members,
				memberCount: count?.members ?? 0,
				queueItemId: item.id,
				queueInvoices: [queuedOne, queuedTwo],
				reconciliation: {
					itemIds: [
						itemIdOf("verified_without_invoice"),
						itemIdOf("amount_mismatch"),
						itemIdOf("discount_without_redemption"),
					],
					redemptionCode,
					entryName: RECONCILIATION_ENTRY_NAME,
					billDiscountName: RECONCILIATION_BILL_DISCOUNT,
				},
				shiftIds: [shiftOne, shiftTwo],
				earnedOnDay: count?.earned ?? 0,
			};
		});
	} finally {
		await sql.end();
	}
}
