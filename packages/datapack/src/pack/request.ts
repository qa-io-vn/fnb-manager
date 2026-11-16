import type { IsoDate } from "@fnb/reports";

export const HORIZONS = ["30d", "90d", "180d", "12m"] as const;
export type Horizon = (typeof HORIZONS)[number];

export const HORIZON_DAYS: Readonly<Record<Horizon, number>> = {
	"30d": 30,
	"90d": 90,
	"180d": 180,
	"12m": 365,
};

export const DEFAULT_HORIZON: Horizon = "90d";

export const PACK_LANGUAGES = ["vi", "en"] as const;
export type PackLanguage = (typeof PACK_LANGUAGES)[number];

export const MAX_PACK_STORES = 10;
export const FOCUS_MAX_LENGTH = 280;
export const OWNER_NOTE_MAX_LENGTH = 1000;

export interface DataPackRequest {
	readonly storeIds: readonly string[];
	readonly asOf: IsoDate | null;
	readonly horizon: Horizon;
	readonly language: PackLanguage;
	readonly focus: string | null;
	readonly ownerNote: string | null;
	readonly sample: boolean;
}

export interface PackStoreRef {
	readonly id: string;
	readonly label: string;
}

export interface ResolvedPackRequest {
	readonly stores: readonly PackStoreRef[];
	readonly asOf: IsoDate;
	readonly horizon: Horizon;
	readonly language: PackLanguage;
	readonly focus: string | null;
	readonly ownerNote: string | null;
	readonly sample: boolean;
	readonly currency: string;
}
