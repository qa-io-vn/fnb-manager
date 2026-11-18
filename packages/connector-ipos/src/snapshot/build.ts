import { LOGIN_PATH } from "../auth.js";
import {
	REMOVED_ITEMS_PATH,
	SALE_EDIT_DELETE_PATH,
} from "../endpoints/pos-cms.js";
import {
	ACCOUNTING_LINES_PATH,
	ACCOUNTING_PAYMENTS_PATH,
	ACCOUNTING_SALES_PATH,
	DAYS_REPORT_PATH,
	MASTER_DATA_PREFIX,
	SHIFTS_REPORT_PATH,
	snapshotKey,
	snapshotRoute,
} from "./routes.js";
import {
	emptyManifest,
	rowMonth,
	type SnapshotOrigin,
	type SnapshotRow,
	type SnapshotStorage,
} from "./storage.js";

export interface SnapshotStoreContent {
	storeUid: string;
	items: SnapshotRow[];
	customizations: SnapshotRow[];
	packages: SnapshotRow[];
	invoices: SnapshotRow[];
	lines: SnapshotRow[];
	payments: SnapshotRow[];
	shifts: SnapshotRow[];
	days: SnapshotRow[];
	editedOrDeleted: SnapshotRow[];
	removedItemEvents: SnapshotRow[];
}

export interface SnapshotBrandContent {
	brandUid: string;
	stores: SnapshotRow[];
	itemTypes: SnapshotRow[];
	itemClasses: SnapshotRow[];
	units: SnapshotRow[];
	sources: SnapshotRow[];
	paymentMethods: SnapshotRow[];
	promotions: SnapshotRow[];
	storeContents: SnapshotStoreContent[];
}

export interface SnapshotContent {
	login: SnapshotRow;
	brands: SnapshotBrandContent[];
	coveredFrom: string | null;
	coveredTo: string | null;
}

export interface WriteSnapshotOptions {
	origin: SnapshotOrigin;
	now?: () => Date;
}

function master(resource: string): string {
	return `${MASTER_DATA_PREFIX}${resource}`;
}

async function writeList(
	storage: SnapshotStorage,
	key: string,
	rows: readonly SnapshotRow[],
): Promise<void> {
	await storage.writeResponse(key, {
		status: 200,
		body: { data: rows, message: null },
	});
}

async function writeRanged(
	storage: SnapshotStorage,
	path: string,
	params: Record<string, string | number | boolean>,
	rows: readonly SnapshotRow[],
): Promise<void> {
	const route = snapshotRoute(path);
	if (route.kind !== "ranged") {
		throw new Error(`${path} is not a ranged iPOS report`);
	}
	const key = snapshotKey("GET", path, params);
	const months = new Map<string, SnapshotRow[]>();
	for (const row of rows) {
		const at = Number(row[route.field]);
		if (!Number.isFinite(at)) {
			throw new Error(`a row for ${path} has no numeric ${route.field}`);
		}
		const month = rowMonth(at);
		months.set(month, [...(months.get(month) ?? []), row]);
	}
	for (const [month, list] of months) {
		list.sort(
			(left, right) => Number(left[route.field]) - Number(right[route.field]),
		);
		await storage.writeRows(key, month, list);
	}
}

async function writeStore(
	storage: SnapshotStorage,
	brandUid: string,
	store: SnapshotStoreContent,
): Promise<void> {
	const listStore = { brand_uid: brandUid, list_store_uid: store.storeUid };
	const oneStore = { brand_uid: brandUid, store_uid: store.storeUid };
	await writeList(
		storage,
		snapshotKey("GET", master("items"), listStore),
		store.items,
	);
	await writeList(
		storage,
		snapshotKey("GET", master("customizations"), oneStore),
		store.customizations,
	);
	await writeList(
		storage,
		snapshotKey("GET", master("packages"), listStore),
		store.packages,
	);
	await writeRanged(storage, ACCOUNTING_SALES_PATH, listStore, store.invoices);
	await writeRanged(storage, ACCOUNTING_LINES_PATH, listStore, store.lines);
	await writeRanged(
		storage,
		ACCOUNTING_PAYMENTS_PATH,
		listStore,
		store.payments,
	);
	await writeRanged(storage, SHIFTS_REPORT_PATH, listStore, store.shifts);
	await writeRanged(
		storage,
		DAYS_REPORT_PATH,
		{ ...listStore, by_days: 1 },
		store.days,
	);
	await writeRanged(
		storage,
		SALE_EDIT_DELETE_PATH,
		oneStore,
		store.editedOrDeleted,
	);
	await writeRanged(
		storage,
		REMOVED_ITEMS_PATH,
		listStore,
		store.removedItemEvents,
	);
}

export async function writeSnapshot(
	storage: SnapshotStorage,
	content: SnapshotContent,
	options: WriteSnapshotOptions,
): Promise<void> {
	const now = options.now ?? (() => new Date());
	await storage.writeResponse(snapshotKey("POST", LOGIN_PATH), {
		status: 200,
		body: { data: content.login, message: null },
	});
	for (const brand of content.brands) {
		const scope = { brand_uid: brand.brandUid };
		const lists: [string, SnapshotRow[], Record<string, string | boolean>][] = [
			["stores", brand.stores, scope],
			["item-types", brand.itemTypes, scope],
			["item-classes", brand.itemClasses, scope],
			["units", brand.units, scope],
			["sources", brand.sources, scope],
			["payment-methods", brand.paymentMethods, scope],
			["promotions", brand.promotions, { ...scope, aggregate: true }],
		];
		for (const [resource, rows, params] of lists) {
			await writeList(
				storage,
				snapshotKey("GET", master(resource), params),
				rows,
			);
		}
		for (const store of brand.storeContents) {
			await writeStore(storage, brand.brandUid, store);
		}
	}
	await storage.writeManifest({
		...emptyManifest(options.origin, now()),
		coveredFrom: content.coveredFrom,
		coveredTo: content.coveredTo,
	});
}
