import type { Channel, DataQualityFlag, PaymentKind } from "@fnb/core";
import { assertTimezone, DEFAULT_SIZE_LABELS } from "@fnb/core";
import type { TokenStore } from "../auth.js";
import type { FetchLike, RetryOptions } from "../http.js";
import type { IposLogger } from "../logger.js";

export const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";
export const DEFAULT_BATCH_DAYS = 7;
export const DEFAULT_MONEY_TOLERANCE = 1;
export const MINUTES_PER_HOUR = 60;
export const DEFAULT_SALE_TYPE_CHANNELS: Readonly<Record<string, Channel>> = {
	OTS: "dine_in",
	TA: "take_away",
};

export interface IposConnectorOptions {
	timezone?: string;
	dayStartMinutes?: number;
	deliverySources?: readonly string[];
	saleTypeChannels?: Readonly<Record<string, Channel>>;
	paymentKindOverrides?: Readonly<Record<string, PaymentKind>>;
	sizeLabels?: readonly string[];
	onFlag?: (flag: DataQualityFlag) => void;
	batchDays?: number;
	resultsPerPage?: number;
	moneyTolerance?: number;
	fetch?: FetchLike;
	baseUrl?: string;
	logger?: IposLogger;
	tokenStore?: TokenStore;
	retry?: RetryOptions;
	requestTimeoutMs?: number;
}

export interface ResolvedIposOptions {
	timezone: string;
	dayStartMinutes: number | undefined;
	deliverySources: ReadonlySet<string>;
	saleTypeChannels: Readonly<Record<string, Channel>>;
	paymentKindOverrides: Readonly<Record<string, PaymentKind>>;
	sizeLabels: readonly string[];
	onFlag: (flag: DataQualityFlag) => void;
	batchDays: number;
	resultsPerPage: number | undefined;
	moneyTolerance: number;
}

export function normaliseName(value: string): string {
	return value.normalize("NFC").trim().toLocaleLowerCase("vi");
}

export function assertWholeHourDayStart(dayStartMinutes: number): void {
	if (
		!Number.isInteger(dayStartMinutes) ||
		dayStartMinutes < 0 ||
		dayStartMinutes % MINUTES_PER_HOUR !== 0
	) {
		throw new RangeError(
			`iPOS expresses the business-day start in whole hours (store_open_at); dayStartMinutes must be a non-negative multiple of ${MINUTES_PER_HOUR}, got ${dayStartMinutes}`,
		);
	}
}

export function resolveIposOptions(
	options: IposConnectorOptions,
): ResolvedIposOptions {
	const timezone = options.timezone ?? DEFAULT_TIMEZONE;
	assertTimezone(timezone);
	if (options.dayStartMinutes !== undefined) {
		assertWholeHourDayStart(options.dayStartMinutes);
	}
	return {
		timezone,
		dayStartMinutes: options.dayStartMinutes,
		deliverySources: new Set(
			(options.deliverySources ?? []).map((source) => normaliseName(source)),
		),
		saleTypeChannels: options.saleTypeChannels ?? DEFAULT_SALE_TYPE_CHANNELS,
		paymentKindOverrides: options.paymentKindOverrides ?? {},
		sizeLabels: options.sizeLabels ?? DEFAULT_SIZE_LABELS,
		onFlag: options.onFlag ?? (() => undefined),
		batchDays: options.batchDays ?? DEFAULT_BATCH_DAYS,
		resultsPerPage: options.resultsPerPage,
		moneyTolerance: options.moneyTolerance ?? DEFAULT_MONEY_TOLERANCE,
	};
}
