import {
	createMemorySnapshotStorage,
	type MemorySnapshotStorage,
	writeSnapshot,
} from "@fnb/connector-ipos/snapshot";
import type { AccountEntry, IposSnapshots } from "../../src/index.js";

export const SNAPSHOT_STORE_UID = "00000000-0000-4000-8000-0000000005a1";
const BRAND_UID = "00000000-0000-4000-8000-0000000005b1";
const COMPANY_UID = "00000000-0000-4000-8000-0000000005c1";

export const IPOS_ENTRY: AccountEntry = {
	key: "account-key-runner",
	connector: "ipos-fabi",
	email: "owner@example.com",
	password: "not-a-real-password",
	appAccessToken: "f".repeat(32),
};

export async function tinySnapshot(): Promise<MemorySnapshotStorage> {
	const storage = createMemorySnapshotStorage();
	const tranDate = Date.UTC(2026, 10, 3, 3, 0);
	const invoice = {
		tran_id: "T-1",
		tran_no: "1",
		tran_date: tranDate,
		store_uid: SNAPSHOT_STORE_UID,
		sale_type: "OTS",
		total_amount: 45_000,
		amount_origin: 45_000,
		payment_method_id: "CASH",
		payment_method_name: "Tiền mặt",
	};
	await writeSnapshot(
		storage,
		{
			login: {
				user: { id: "u-1", email: "owner@example.com" },
				company: { id: COMPANY_UID },
				brands: [{ id: BRAND_UID, brand_name: "Brand", currency: "VND" }],
				cities: [],
				stores: [
					{
						id: SNAPSHOT_STORE_UID,
						brand_uid: BRAND_UID,
						company_uid: COMPANY_UID,
						store_name: "Snapshot store",
						open_at: 0,
					},
				],
			},
			brands: [
				{
					brandUid: BRAND_UID,
					stores: [],
					itemTypes: [],
					itemClasses: [],
					units: [],
					sources: [],
					paymentMethods: [],
					promotions: [],
					storeContents: [
						{
							storeUid: SNAPSHOT_STORE_UID,
							items: [],
							customizations: [],
							packages: [],
							invoices: [invoice],
							lines: [
								{
									...invoice,
									id: "L-1",
									item_id: "I-1",
									item_name: "Trà (M)",
									quantity: 1,
									price: 45_000,
									amount: 45_000,
								},
							],
							payments: [{ ...invoice, amount: 45_000 }],
							shifts: [],
							days: [
								{
									date: "2026-11-03",
									tran_date: Date.UTC(2026, 10, 2, 17, 0),
									total_sales: 1,
									revenue_gross: 45_000,
									revenue_net: 45_000,
								},
							],
							editedOrDeleted: [],
							removedItemEvents: [],
						},
					],
				},
			],
			coveredFrom: "2026-11-01",
			coveredTo: "2026-11-05",
		},
		{ origin: "database" },
	);
	return storage;
}

export function memorySnapshots(
	byKey: Record<string, MemorySnapshotStorage>,
	options: { recordTo?: MemorySnapshotStorage; warnings?: string[] } = {},
): IposSnapshots {
	return {
		open: (key) => byKey[key] ?? createMemorySnapshotStorage(),
		recordTo: () => options.recordTo ?? null,
		warn: (line) => options.warnings?.push(line),
	};
}
