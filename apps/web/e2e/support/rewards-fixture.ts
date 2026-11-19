import {
	FIXTURE_SLUG_PREFIX,
	openFixtureDatabase,
	type SettingsFixture,
} from "./settings-fixture";

export const REWARD_PROGRAMME_NAME = "Ưu đãi thử E2E";
export const MAPPED_REWARD_KEY = "ly-tra-sua-e2e";
export const MAPPED_DISCOUNT_NAME = "Ly trà sữa thành viên";
export const PERCENT_REWARD = {
	key: "giam-10",
	name: "Giảm 10% hóa đơn",
	discountName: "Ưu đãi thành viên 10%",
} as const;
export const FREE_ITEM_REWARD = {
	key: "ly-mien-phi",
	name: "Ly trà miễn phí",
	discountName: "Ly miễn phí thành viên",
} as const;
export const REDEEMING_MEMBER_PHONE = "0900000561";

export interface RewardsFixture {
	readonly programmeId: string;
	readonly day: string;
	readonly storeOne: string;
	readonly storeTwo: string;
}

function guarded(fixture: SettingsFixture): void {
	if (!fixture.slug.startsWith(FIXTURE_SLUG_PREFIX)) {
		throw new Error(
			"the rewards fixture writes only to a settings fixture tenant",
		);
	}
}

export async function createRewardsFixture(
	fixture: SettingsFixture,
): Promise<RewardsFixture> {
	guarded(fixture);
	const [storeOne, storeTwo] = fixture.storeIds;
	const day = fixture.sales.to;
	const owner = fixture.logins.owner.userId;
	const sql = openFixtureDatabase();
	try {
		return await sql.begin(async (tx) => {
			const [programme] = await tx<{ id: string }[]>`
				insert into public.loyalty_programmes (
					tenant_id, name, starts_on, status, notification_decision, created_by
				)
				values (
					${fixture.tenantId}, ${REWARD_PROGRAMME_NAME}, ${day}::date - 30, 'active',
					'below_threshold', ${owner}
				)
				returning id
			`;
			if (programme === undefined) throw new Error("no programme");
			await tx`
				insert into public.coupon_rails (tenant_id, store_id, rail, active_from, created_by, updated_by)
				values (
					${fixture.tenantId}, ${storeOne}, 'pos_payment_discount',
					(${day}::date - 2)::timestamp at time zone 'Asia/Ho_Chi_Minh', ${owner}, ${owner}
				)
			`;
			for (const [key, name] of [
				[MAPPED_REWARD_KEY, MAPPED_DISCOUNT_NAME],
				[PERCENT_REWARD.key, PERCENT_REWARD.discountName],
				[FREE_ITEM_REWARD.key, FREE_ITEM_REWARD.discountName],
			] as const) {
				await tx`
					insert into public.coupon_rail_rewards (
						tenant_id, store_id, reward_key, pos_discount_name, einvoice_display, created_by, updated_by
					)
					values (${fixture.tenantId}, ${storeOne}, ${key}, ${name}, 'discount', ${owner}, ${owner})
				`;
			}
			return { programmeId: programme.id, day, storeOne, storeTwo };
		});
	} finally {
		await sql.end();
	}
}

export async function retireActiveRewards(
	fixture: SettingsFixture,
): Promise<void> {
	guarded(fixture);
	const sql = openFixtureDatabase();
	try {
		await sql`
			update public.coupons
			set status = 'retired'
			where tenant_id = ${fixture.tenantId}
				and status = 'active'
		`;
	} finally {
		await sql.end();
	}
}

export interface SeededRedemptions {
	readonly membershipId: string;
	readonly redemptionIds: readonly string[];
}

export async function seedRedemptions(
	fixture: SettingsFixture,
	rewards: RewardsFixture,
): Promise<SeededRedemptions> {
	guarded(fixture);
	const tenantId = fixture.tenantId;
	const { storeOne, day, programmeId } = rewards;
	const sql = openFixtureDatabase();
	try {
		return await sql.begin(async (tx) => {
			await tx`select set_config('request.jwt.claims', '', true)`;
			const local = async (time: string): Promise<string> => {
				const [row] = await tx<{ at: string }[]>`
					select ((${day}::date + ${time}::time) at time zone 'Asia/Ho_Chi_Minh')::text as at
				`;
				if (row === undefined) throw new Error("no local time");
				return row.at;
			};
			const joinedAt = await local("06:00");
			const [member] = await tx<{ id: string }[]>`
				select app.loyalty_join(
					${tenantId}::uuid,
					app.loyalty_customer_for_phone(${tenantId}::uuid, ${REDEEMING_MEMBER_PHONE}, ${joinedAt}::timestamptz),
					'mini_app', ${storeOne}::uuid, null, null, ${joinedAt}::timestamptz
				) as id
			`;
			if (member?.id === undefined) throw new Error("no membership");
			const [credit] = await tx<{ id: string }[]>`
				insert into public.loyalty_ledger (
					tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta,
					value_amount, reason, approved_by, business_date, expires_at, occurred_at
				)
				values (
					${tenantId}, ${programmeId}, ${member.id}, ${storeOne}, 'adjust', 10, 0,
					0, 'Bù dấu thử E2E', ${fixture.logins.owner.userId}, ${day}::date,
					now() + interval '30 days', ${joinedAt}::timestamptz
				)
				returning id
			`;
			if (credit === undefined) throw new Error("no credit");
			await tx`
				insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
				select ${tenantId}, ${member.id}, ${credit.id}, ${joinedAt}::timestamptz, now() + interval '180 days'
				from generate_series(1, 10)
			`;
			const coupons = await tx<{ id: string; reward_key: string }[]>`
				insert into public.coupons (
					tenant_id, programme_id, reward_key, name, reward_kind, reward_percent,
					reward_item_external_ids, cost_stamps, store_ids, status
				)
				values
					(${tenantId}, ${programmeId}, ${PERCENT_REWARD.key}, ${PERCENT_REWARD.name}, 'percent_off', 10,
						null, 1, ${[storeOne]}::uuid[], 'active'),
					(${tenantId}, ${programmeId}, ${FREE_ITEM_REWARD.key}, ${FREE_ITEM_REWARD.name}, 'free_item', null,
						${["ITEM-1"]}::text[], 2, ${[storeOne]}::uuid[], 'active')
				returning id, reward_key
			`;
			const couponOf = (key: string): string => {
				const found = coupons.find((row) => row.reward_key === key)?.id;
				if (found === undefined) throw new Error(`no coupon ${key}`);
				return found;
			};
			const redeem = async (key: string, time: string): Promise<string> => {
				const at = await local(time);
				const [answer] = await tx<
					{ id: string | null; refusal: string | null }[]
				>`
					select a ->> 'redemption_id' as id, a ->> 'refusal' as refusal
					from app.redeem_coupon(${member.id}::uuid, ${couponOf(key)}::uuid, ${storeOne}::uuid, ${at}::timestamptz) as a
				`;
				if (answer?.id == null) {
					throw new Error(`the redemption was refused: ${answer?.refusal}`);
				}
				return answer.id;
			};
			const confirm = async (
				redemptionId: string,
				name: string,
				time: string,
				gross: number,
				discount: number,
			) => {
				const soldAt = await local(time);
				const [invoice] = await tx<{ id: string }[]>`
					insert into public.invoices (
						tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date,
						gross_amount, bill_discount_name, bill_discount_amount, net_amount, paid_amount
					)
					values (
						${tenantId}, ${storeOne}, ${fixture.accountId}, ${`E2E-RW-${name}`}, ${`RW${name}`},
						${soldAt}::timestamptz, app.store_business_date(${storeOne}::uuid, ${soldAt}::timestamptz),
						${gross}, ${PERCENT_REWARD.discountName}, ${discount}, ${gross - discount}, ${gross - discount}
					)
					returning id
				`;
				if (invoice === undefined) throw new Error("no invoice");
				await tx`
					select app.confirm_redemption(${redemptionId}::uuid, ${invoice.id}::uuid, ${soldAt}::timestamptz + interval '5 minutes')
				`;
			};
			const first = await redeem(PERCENT_REWARD.key, "09:00");
			await confirm(first, "1", "09:05", 60_000, 6_000);
			const second = await redeem(PERCENT_REWARD.key, "10:00");
			await confirm(second, "2", "10:05", 50_000, 5_000);
			const third = await redeem(FREE_ITEM_REWARD.key, "11:00");
			return { membershipId: member.id, redemptionIds: [first, second, third] };
		});
	} finally {
		await sql.end();
	}
}
