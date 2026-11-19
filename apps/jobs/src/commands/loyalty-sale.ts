import { randomUUID } from "node:crypto";
import {
	businessDate,
	type CanonicalSale,
	normalizeLoyaltyPhone,
} from "@fnb/core";
import { loyaltyLine, reconcileLoyaltySafely } from "@fnb/runner";
import { mapSale, type SyncRepository } from "@fnb/sync";
import { isLocalDatabaseUrl } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { findTenant } from "../admin/tenants.js";
import { ConfigError } from "../config/errors.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	requiredString,
	stringOption,
	UsageError,
} from "../context.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

export const REAL_TENANT_SLUG = "live-local";
export const SIMULATED_TENANT_PATTERN = /^loyalty-sim(?:-[a-z0-9]+)*$/;
export const MAX_SIMULATED_AMOUNT = 100_000_000;

export interface SaleTenant {
	readonly id: string;
	readonly slug: string;
	readonly timezone: string;
}

export interface SaleStore {
	readonly id: string;
	readonly externalId: string;
	readonly name: string;
	readonly posAccountId: string;
	readonly timezone: string;
	readonly businessDayStartMinutes: number;
	readonly tranNoResetPeriod: string;
}

export function simulationRefusal(
	slug: string,
	iposSource: string | null,
): string | null {
	if (slug === REAL_TENANT_SLUG) {
		return `refused: ${REAL_TENANT_SLUG} is the real shop; simulate sales on a synthetic tenant`;
	}
	if (iposSource === "api") {
		return "refused: this tenant is registered as fed by the real iPOS API (app.tenant_ipos_sources); simulate sales on a synthetic tenant";
	}
	return null;
}

export function parseAmount(text: string): number {
	const cleaned = text.replace(/[.,_\s]/g, "");
	const amount = Number(cleaned);
	if (
		!/^\d+$/.test(cleaned) ||
		!Number.isSafeInteger(amount) ||
		amount < 1 ||
		amount > MAX_SIMULATED_AMOUNT
	) {
		throw new UsageError(
			`--amount takes a whole amount in dong from 1 to ${MAX_SIMULATED_AMOUNT}`,
		);
	}
	return amount;
}

export function nextReceiptNumber(
	previous: readonly (string | null)[],
): string {
	let highest = 0;
	for (const value of previous) {
		if (value !== null && /^\d{1,12}$/.test(value.trim())) {
			highest = Math.max(highest, Number(value.trim()));
		}
	}
	return String(highest + 1).padStart(4, "0");
}

export interface SaleReward {
	readonly discountName: string | null;
	readonly voucherCode: string | null;
	readonly discountAmount: number;
}

export const NO_REWARD: SaleReward = {
	discountName: null,
	voucherCode: null,
	discountAmount: 0,
};

const DISCOUNT_NAME_PATTERN = /^[^\p{Cc}]{1,200}$/u;
const VOUCHER_CODE_PATTERN = /^[^\s\p{Cc}]{1,64}$/u;

export function parseSaleReward(
	values: {
		readonly discountName: string | undefined;
		readonly voucherCode: string | undefined;
		readonly discountAmount: string | undefined;
	},
	amount: number,
): SaleReward {
	const discountName = values.discountName?.trim() ?? null;
	const voucherCode = values.voucherCode?.trim() ?? null;
	if (discountName !== null && !DISCOUNT_NAME_PATTERN.test(discountName)) {
		throw new UsageError(
			"--discount-name takes the POS discount entry name, 1 to 200 characters",
		);
	}
	if (voucherCode !== null && !VOUCHER_CODE_PATTERN.test(voucherCode)) {
		throw new UsageError(
			"--voucher-code takes a code of 1 to 64 characters without spaces",
		);
	}
	let discountAmount = 0;
	if (values.discountAmount !== undefined) {
		if (discountName === null && voucherCode === null) {
			throw new UsageError(
				"--discount-amount goes with --discount-name or --voucher-code",
			);
		}
		const cleaned = values.discountAmount.replace(/[.,_\s]/g, "");
		discountAmount = Number(cleaned);
		if (
			!/^\d+$/.test(cleaned) ||
			!Number.isSafeInteger(discountAmount) ||
			discountAmount > amount
		) {
			throw new UsageError(
				`--discount-amount takes a whole amount in dong from 0 to the sale amount (${amount})`,
			);
		}
	}
	return { discountName, voucherCode, discountAmount };
}

export function simulatedSale(input: {
	readonly externalId: string;
	readonly receiptNo: string;
	readonly soldAt: Date;
	readonly businessDate: string;
	readonly amount: number;
	readonly phone: string | null;
	readonly reward?: SaleReward;
}): CanonicalSale {
	const reward = input.reward ?? NO_REWARD;
	const billDiscount = reward.discountName === null ? 0 : reward.discountAmount;
	const voucherDiscount =
		reward.discountName === null && reward.voucherCode !== null
			? reward.discountAmount
			: 0;
	const net = input.amount - billDiscount - voucherDiscount;
	return {
		externalId: input.externalId,
		receiptNo: input.receiptNo,
		soldAt: input.soldAt,
		businessDate: input.businessDate,
		openedAt: input.soldAt,
		closedAt: input.soldAt,
		channel: "dine_in",
		sourceName: "simulated-till",
		guestCount: 1,
		...(input.phone === null ? {} : { customerPhone: input.phone }),
		grossAmount: input.amount,
		itemDiscountAmount: 0,
		billDiscountAmount: billDiscount,
		...(reward.discountName === null
			? {}
			: { billDiscountName: reward.discountName }),
		...(reward.voucherCode === null ? {} : { voucherCode: reward.voucherCode }),
		voucherAmount: voucherDiscount,
		partnerMarketingAmount: 0,
		serviceChargeAmount: 0,
		shippingFeeAmount: 0,
		vatAmount: 0,
		netAmount: net,
		paidAmount: net,
		status: "completed",
		lines: [
			{
				externalId: `${input.externalId}-1`,
				lineKind: "item",
				itemName: "Simulated drink",
				baseName: "Simulated drink",
				quantity: 1,
				unitPrice: input.amount,
				grossAmount: input.amount,
				discountAmount: 0,
				netAmount: input.amount,
				raw: { simulated: true },
			},
		],
		payments: [
			{
				methodExternalId: "simulated-cash",
				methodName: "Simulated cash",
				kind: "cash",
				amount: net,
				feeAmount: 0,
				raw: { simulated: true },
			},
		],
		raw: { simulated: true, receipt_no: input.receiptNo },
	};
}

async function iposSourceOf(
	sql: Sql,
	tenantId: string,
): Promise<string | null> {
	const [row] = await sql<{ source: string }[]>`
		select source from app.tenant_ipos_sources where tenant_id = ${tenantId}::uuid
	`;
	return row?.source ?? null;
}

async function storesOf(sql: Sql, tenantId: string): Promise<SaleStore[]> {
	return sql<SaleStore[]>`
		select s.id, s.external_id as "externalId", s.name, s.pos_account_id as "posAccountId", s.timezone,
			s.business_day_start_minutes as "businessDayStartMinutes", s.tran_no_reset_period::text as "tranNoResetPeriod"
		from public.stores s
		where s.tenant_id = ${tenantId}::uuid and s.active
		order by s.external_id
	`;
}

async function setUpSimulatedTenant(sql: Sql, slug: string): Promise<void> {
	await sql.begin(async (transaction) => {
		const [tenant] = await transaction<{ id: string }[]>`
			insert into public.tenants (slug, name) values (${slug}, 'Synthetic loyalty shop')
			on conflict (slug) do update set slug = excluded.slug
			returning id
		`;
		if (!tenant) {
			throw new ConfigError("the synthetic tenant could not be created");
		}
		const [account] = await transaction<{ id: string }[]>`
			insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
			values (${tenant.id}::uuid, 'mock', ${`${slug}-till`}, 'Simulated till')
			on conflict do nothing
			returning id
		`;
		const accountId =
			account?.id ??
			(
				await transaction<{ id: string }[]>`
					select id from public.pos_accounts where tenant_id = ${tenant.id}::uuid and account_key = ${`${slug}-till`}
				`
			)[0]?.id;
		if (accountId === undefined) {
			throw new ConfigError("the synthetic till account could not be created");
		}
		await transaction`
			insert into public.stores (tenant_id, pos_account_id, external_id, name, tran_no_reset_period, e_invoice_status)
			select ${tenant.id}::uuid, ${accountId}::uuid, v.external_id, v.name, v.reset::public.tran_no_reset_period, 'not_configured'
			from (values ('sim-1', 'Synthetic store 1', 'daily'), ('sim-2', 'Synthetic store 2', 'yearly')) as v (external_id, name, reset)
			where not exists (select 1 from public.stores s where s.tenant_id = ${tenant.id}::uuid and s.external_id = v.external_id)
		`;
		await transaction`
			insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, notification_basis, status)
			select ${tenant.id}::uuid, 'Synthetic programme', date '2026-01-01', 'not_required', 'Synthetic tenant for local testing only', 'active'
			where not exists (select 1 from public.loyalty_programmes p where p.tenant_id = ${tenant.id}::uuid and p.status = 'active')
		`;
	});
}

export interface SaleReceipt {
	readonly store: SaleStore;
	readonly businessDate: string;
	readonly receiptNo: string;
	readonly amount: number;
	readonly netAmount: number;
	readonly soldAt: Date;
	readonly invoiceExternalId: string;
}

export async function recordSimulatedSale(
	sql: Sql,
	repository: Pick<SyncRepository, "applyStoreDay">,
	store: SaleStore,
	tenantId: string,
	amount: number,
	phone: string | null,
	at: Date,
	reward: SaleReward = NO_REWARD,
): Promise<SaleReceipt> {
	const date = businessDate(at, store.timezone, store.businessDayStartMinutes);
	const sameDayOnly = store.tranNoResetPeriod === "daily";
	const previous = await sql<{ receipt_no: string | null }[]>`
		select i.receipt_no
		from public.invoices i
		where i.store_id = ${store.id}::uuid
			and (case when ${sameDayOnly} then i.business_date = ${date}::date
			     else date_trunc('year', i.business_date) = date_trunc('year', ${date}::date) end)
	`;
	const receiptNo = nextReceiptNumber(previous.map((row) => row.receipt_no));
	const externalId = `sim-${at.getTime()}-${randomUUID().slice(0, 8)}`;
	const sale = simulatedSale({
		externalId,
		receiptNo,
		soldAt: at,
		businessDate: date,
		amount,
		phone,
		reward,
	});
	const mapped = mapSale(sale, {
		tenantId,
		storeId: store.id,
		posAccountId: store.posAccountId,
		businessDate: date,
	});
	await repository.applyStoreDay({
		tenant_id: tenantId,
		store_id: store.id,
		business_date: date,
		sales: [mapped.write],
		status_changes: [],
		events: [],
	});
	return {
		store,
		businessDate: date,
		receiptNo,
		amount,
		netAmount: sale.netAmount,
		soldAt: at,
		invoiceExternalId: externalId,
	};
}

function phoneHint(phone: string): string {
	return `…${phone.slice(-3)}`;
}

async function loyaltySale(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = requiredString(values, "tenant").trim();
	const amount = parseAmount(requiredString(values, "amount"));
	const phoneText = stringOption(values, "phone");
	const phone =
		phoneText === undefined ? null : normalizeLoyaltyPhone(phoneText);
	if (phoneText !== undefined && phone === null) {
		throw new UsageError("--phone takes a phone number, such as 0900001234");
	}
	const reward = parseSaleReward(
		{
			discountName: stringOption(values, "discount-name"),
			voucherCode: stringOption(values, "voucher-code"),
			discountAmount: stringOption(values, "discount-amount"),
		},
		amount,
	);
	const { sql, repository, runner, setting } = context.services.db();
	if (!isLocalDatabaseUrl(setting.url)) {
		throw new ConfigError(
			`refused: ${setting.variable} does not name the local stack; the simulated till writes only to a local database`,
		);
	}
	if (slug === REAL_TENANT_SLUG) {
		throw new UsageError(simulationRefusal(slug, null) ?? "refused");
	}
	let tenant = await findTenant(sql, slug);
	if (tenant === null && flag(values, "setup")) {
		if (!SIMULATED_TENANT_PATTERN.test(slug)) {
			throw new UsageError(
				"--setup creates only a tenant whose slug starts with loyalty-sim",
			);
		}
		await setUpSimulatedTenant(sql, slug);
		tenant = await findTenant(sql, slug);
	}
	if (tenant === null) {
		throw new UsageError(
			`no tenant with slug "${slug}"; pass --setup with a loyalty-sim slug to create a synthetic one`,
		);
	}
	const refusal = simulationRefusal(
		tenant.slug,
		await iposSourceOf(sql, tenant.id),
	);
	if (refusal !== null) {
		throw new UsageError(refusal);
	}
	const stores = await storesOf(sql, tenant.id);
	const wanted = stringOption(values, "store");
	const store =
		wanted === undefined
			? stores[0]
			: stores.find(
					(candidate) =>
						candidate.externalId === wanted || candidate.id === wanted,
				);
	if (store === undefined) {
		throw new UsageError(
			wanted === undefined
				? "the tenant has no active store"
				: `no active store "${wanted}" in the tenant`,
		);
	}
	const receipt = await recordSimulatedSale(
		sql,
		repository,
		store,
		tenant.id,
		amount,
		phone,
		context.now(),
		reward,
	);
	const loyalty = await reconcileLoyaltySafely(
		runner,
		tenant.id,
		{ fromDate: receipt.businessDate, toDate: receipt.businessDate },
		context.now(),
		context.redact,
	);
	const local = new Intl.DateTimeFormat("vi-VN", {
		timeZone: store.timezone,
		dateStyle: "short",
		timeStyle: "medium",
	}).format(receipt.soldAt);
	const lines = [
		`simulated sale on ${tenant.slug}`,
		`  store:         ${store.name} (external id ${store.externalId}, id ${store.id})`,
		`  business date: ${receipt.businessDate}`,
		`  receipt no:    ${receipt.receiptNo}`,
		`  amount:        ${receipt.amount}`,
		...(reward.discountName === null
			? []
			: [
					`  discount:      "${reward.discountName}" of ${reward.discountAmount} (payment discount entry)`,
				]),
		...(reward.voucherCode === null
			? []
			: [
					`  voucher code:  ${reward.voucherCode}${reward.discountName === null ? ` of ${reward.discountAmount}` : ""}`,
				]),
		...(receipt.netAmount === receipt.amount
			? []
			: [`  net amount:    ${receipt.netAmount}`]),
		`  sold at:       ${local} (${store.timezone})`,
		...(phone === null
			? []
			: [`  phone:         ${phoneHint(phone)} on the invoice (path A)`]),
		`  ${loyaltyLine(loyalty)}`,
		"claim it in the customer app with this store, business date, receipt number and net amount",
	];
	for (const line of lines) {
		context.output.line(line);
	}
	return loyalty.status === "failed" ? 1 : 0;
}

export const loyaltySaleCommand: CommandSpec = {
	path: ["loyalty", "sale"],
	summary:
		"Simulated till: write one synthetic sale to a local synthetic tenant through the sync's write path, then reconcile",
	usage:
		"fnb loyalty sale --tenant <slug> --amount <dong> [--store <external id>] [--phone <phone>] [--discount-name <entry name>] [--voucher-code <code>] [--discount-amount <dong>] [--setup]",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		amount: { type: "string" },
		store: { type: "string" },
		phone: { type: "string" },
		"discount-name": { type: "string" },
		"voucher-code": { type: "string" },
		"discount-amount": { type: "string" },
		setup: { type: "boolean" },
	},
	details: [
		"Writes one completed sale, sold now, with the next receipt number of the store (per business day for a store that resets daily, per year otherwise), through the same store-day write the sync uses, then runs the loyalty reconciliation of that business day. It prints the store, business date, receipt number and amount, so a person can claim the receipt in the customer app.",
		"--phone puts the number on the invoice as a cashier would with a member attached (path A). --setup creates a missing loyalty-sim tenant with a mock account, two stores (receipt numbers resetting daily and yearly) and an active synthetic programme.",
		"--discount-name puts a payment discount entry (Chiết khấu thanh toán) of that name on the invoice, as the cashier does on the fallback rail after staff verified a reward code; --voucher-code puts a voucher code on it, as a code-pool or callback rail does. --discount-amount (0 by default) is the discount in dong: the payment discount with --discount-name, else the voucher amount; the net is the amount less it. The reconciliation then confirms the matching redemption.",
		`Calls no POS. Refuses a database that is not the local stack, the ${REAL_TENANT_SLUG} tenant and any tenant registered in app.tenant_ipos_sources as fed by the real iPOS API.`,
	],
	run: loyaltySale,
};
