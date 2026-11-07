import type {
	CanonicalAdjustment,
	CanonicalCatalog,
	CanonicalDailyTotal,
	CanonicalSale,
	CanonicalShift,
	CanonicalStore,
	DataQualityFlag,
} from "@fnb/core";
import type { ZodType } from "zod";

export const CAPABILITY_NAMES = [
	"lines",
	"modifiers",
	"payments",
	"shifts",
	"adjustments",
	"controlTotals",
	"customers",
	"guestCount",
	"costs",
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

export type ConnectorCapabilities = Readonly<Record<CapabilityName, boolean>>;

export interface ConnectorDescriptor {
	id: string;
	label: string;
	capabilities: ConnectorCapabilities;
	credentialsSchema: ZodType;
	notes?: readonly string[];
}

export interface BusinessDateWindow {
	fromDate: string;
	toDate: string;
}

export type FlagSink = (flag: DataQualityFlag) => void;

export interface FetchContext {
	onFlag?: FlagSink;
}

export interface PosConnector {
	describe(): ConnectorDescriptor;
	authenticate(credentials: unknown): Promise<void>;
	discoverStores(): Promise<CanonicalStore[]>;
	fetchCatalog(store: CanonicalStore): Promise<CanonicalCatalog>;
	fetchSales(
		store: CanonicalStore,
		window: BusinessDateWindow,
		context?: FetchContext,
	): AsyncIterable<CanonicalSale[]>;
	fetchShifts(
		store: CanonicalStore,
		window: BusinessDateWindow,
		context?: FetchContext,
	): Promise<CanonicalShift[]>;
	fetchAdjustments(
		store: CanonicalStore,
		window: BusinessDateWindow,
		context?: FetchContext,
	): Promise<CanonicalAdjustment[]>;
	fetchControlTotals(
		store: CanonicalStore,
		window: BusinessDateWindow,
		context?: FetchContext,
	): Promise<CanonicalDailyTotal[]>;
}

export async function collectSales(
	batches: AsyncIterable<CanonicalSale[]>,
): Promise<CanonicalSale[]> {
	const sales: CanonicalSale[] = [];
	for await (const batch of batches) {
		sales.push(...batch);
	}
	return sales;
}
