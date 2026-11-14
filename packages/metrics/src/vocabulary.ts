export const metricGroups = {
	sales: "Sales, ticket and basket",
	time: "Time productivity",
	baselines: "Baselines and forecasts",
	menu: "Menu",
	cash: "Cash and adjustments",
	promotions: "Promotions and compliance",
	quality: "Data quality",
	customers: "Customers and loyalty",
} as const;

export type MetricGroup = keyof typeof metricGroups;

export const reportNames = {
	today: "Hôm nay",
	day: "Ngày",
	week: "Tuần",
	month: "Tháng",
	year: "Năm",
	revenue: "Doanh thu & xu hướng",
	hours: "Giờ & ngày trong tuần",
	menu: "Thực đơn",
	payments: "Thanh toán & tiền mặt",
	promotions: "Khuyến mãi & giảm giá",
	shifts: "Ca & két tiền",
	stores: "So sánh cửa hàng",
	data_quality: "Chất lượng dữ liệu",
	customers: "Khách hàng",
	data_pack: "data pack",
	alerts: "alerts",
} as const;

export type ReportId = keyof typeof reportNames;

export const periodicReports = [
	"day",
	"week",
	"month",
	"year",
] as const satisfies readonly ReportId[];

export const metricGrains = [
	"store-day",
	"store-hour",
	"store-week",
	"store-period",
	"item-period",
	"shift",
	"cashier-period",
	"customer",
	"segment",
	"cohort-month",
	"tenant-month",
	"tenant-period",
] as const;

export type MetricGrain = (typeof metricGrains)[number];

export const storeGrains = [
	"store-day",
	"store-period",
] as const satisfies readonly MetricGrain[];

export const metricDirections = ["higher", "lower", "neutral"] as const;

export type MetricDirection = (typeof metricDirections)[number];

export const metricStatuses = [
	"available now",
	"needs costs",
	"needs customer identity",
	"needs customer identity and costs",
	"needs seats",
] as const;

export type MetricStatus = (typeof metricStatuses)[number];

export const metricUnits = [
	"VND",
	"count",
	"items",
	"fraction",
	"VND / hour",
	"count / hour",
	"VND / seat-hour",
	"VND and count",
	"% change",
	"class",
	"z",
	"visits / customer",
	"scores 1–5",
] as const;

export type MetricUnit = (typeof metricUnits)[number];

export interface MetricLabel {
	readonly vi: string;
	readonly en: string;
}

export interface MetricDefinition {
	readonly id: string;
	readonly group: MetricGroup;
	readonly label: MetricLabel;
	readonly unit: MetricUnit;
	readonly formula: string;
	readonly grains: readonly MetricGrain[];
	readonly grainNote?: string;
	readonly direction: MetricDirection;
	readonly directionOnAbsoluteValue?: boolean;
	readonly source: string;
	readonly reports: readonly ReportId[];
	readonly reportNotes?: Readonly<Partial<Record<ReportId, string>>>;
	readonly status: MetricStatus;
	readonly statusNote?: string;
}

export interface BenchmarkContextEntry {
	readonly id: string;
	readonly figure: string;
	readonly year: string;
	readonly source: string;
}
