import { findMetric } from "@fnb/metrics";
import { roundHalfAwayFromZero } from "@fnb/reports";
import { canonicalJson } from "../pack/canonical.js";
import { formatDecimal } from "../pack/decimal.js";
import { DataPackError } from "../pack/errors.js";
import type { PackLanguage } from "../pack/request.js";
import type { DataPack } from "../pack/schema.js";
import { currencyMinorUnits, type PackUnit } from "../pack/units.js";
import {
	ALL_SCOPE,
	BAND_HIGH_COLUMN,
	BAND_LOW_COLUMN,
	BASELINE_COLUMN,
	KPI_TABLE,
	resolveCell,
} from "../plan/citations.js";
import {
	INITIATIVE_FIELDS,
	INITIATIVE_HEADING,
	type InitiativeFieldId,
	MIN_INITIATIVES,
	PLAN_FORMAT,
	PLAN_SECTIONS,
	type PlanSectionId,
} from "../plan/sections.js";

export const SAMPLE_KPI_IDS = [
	"avg_ticket",
	"attach_rate_topping",
	"discount_rate",
	"items_per_ticket",
	"size_l_share",
	"invoices",
	"net_revenue",
] as const;

export const SAMPLE_KPI_COUNT = 3;
export const SAMPLE_TARGET_STEP = 0.05;

const PERCENT_DIGITS = 2;
const CHANGE_COLUMN = "p28_change";
const GAPS_LISTED = 5;

const METRIC_UNIT_DIGITS: Readonly<Record<string, number | "currency">> = {
	VND: "currency",
	"VND / hour": "currency",
	count: 0,
	"count / hour": 2,
	items: 2,
	fraction: 4,
};

const CURRENCY_UNITS: ReadonlySet<string> = new Set(["VND", "VND / hour"]);

type Direction = "higher" | "lower";

export interface SampleKpi {
	readonly id: string;
	readonly label: string;
	readonly direction: Direction;
	readonly metricUnit: string;
	readonly digits: number;
	readonly baseline: number;
	readonly target: number;
	readonly initiatives: readonly number[];
}

interface Cell {
	readonly ref: string;
	readonly value: number;
	readonly unit: PackUnit;
}

interface Evidence {
	readonly cell: Cell;
	readonly detail: string;
}

interface EvidenceSource {
	find(pack: DataPack): Evidence | null;
	sentence(language: PackLanguage, written: string, citation: string): string;
}

interface InitiativeText {
	readonly title: string;
	readonly action: string;
	readonly effort: string;
	readonly firstStep: string;
}

interface InitiativeTemplate {
	readonly source: EvidenceSource;
	text(language: PackLanguage, pack: DataPack, detail: string): InitiativeText;
}

const NUMBER_STYLES: Readonly<
	Record<PackLanguage, { thousands: string; decimal: string }>
> = {
	vi: { thousands: ".", decimal: "," },
	en: { thousands: ",", decimal: "." },
};

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const WEEKDAY_NAMES: Readonly<
	Record<PackLanguage, Readonly<Record<string, string>>>
> = {
	vi: {
		mon: "Thứ Hai",
		tue: "Thứ Ba",
		wed: "Thứ Tư",
		thu: "Thứ Năm",
		fri: "Thứ Sáu",
		sat: "Thứ Bảy",
		sun: "Chủ Nhật",
	},
	en: {
		mon: "Monday",
		tue: "Tuesday",
		wed: "Wednesday",
		thu: "Thursday",
		fri: "Friday",
		sat: "Saturday",
		sun: "Sunday",
	},
};

const PLAIN_NAME = /^[\p{L}\p{M}][\p{L}\p{M} ()'&.,+-]{0,59}$/u;

function byLanguage(language: PackLanguage, vi: string, en: string): string {
	return language === "vi" ? vi : en;
}

function numericCell(
	pack: DataPack,
	table: string,
	row: string,
	column: string,
): Cell | null {
	const resolved = resolveCell(pack, table, row, column);
	if (
		resolved === null ||
		typeof resolved.cell !== "number" ||
		!Number.isFinite(resolved.cell)
	) {
		return null;
	}
	return {
		ref: `${table}:${resolved.row}:${column}`,
		value: resolved.cell,
		unit: resolved.unit,
	};
}

function textCell(
	pack: DataPack,
	table: string,
	row: string,
	column: string,
): string | null {
	const resolved = resolveCell(pack, table, row, column);
	return resolved !== null &&
		typeof resolved.cell === "string" &&
		PLAIN_NAME.test(resolved.cell)
		? resolved.cell
		: null;
}

function metricDigits(unit: string, currency: string): number | null {
	if (!Object.hasOwn(METRIC_UNIT_DIGITS, unit)) return null;
	const digits = METRIC_UNIT_DIGITS[unit];
	if (digits === undefined) return null;
	return digits === "currency" ? currencyMinorUnits(currency) : digits;
}

export function sampleTarget(
	baseline: number,
	direction: Direction,
	digits: number,
): number {
	const factor =
		direction === "higher" ? 1 + SAMPLE_TARGET_STEP : 1 - SAMPLE_TARGET_STEP;
	const rounded = roundHalfAwayFromZero(baseline * factor, digits);
	if (rounded !== baseline) return rounded;
	const unit = 10 ** -digits;
	return roundHalfAwayFromZero(
		direction === "higher" ? rounded + unit : rounded - unit,
		digits,
	);
}

export function sampleKpis(pack: DataPack): SampleKpi[] {
	const chosen: Omit<SampleKpi, "initiatives">[] = [];
	for (const id of SAMPLE_KPI_IDS) {
		if (chosen.length === SAMPLE_KPI_COUNT) break;
		const metric = findMetric(id);
		const baseline = numericCell(
			pack,
			KPI_TABLE,
			`${ALL_SCOPE}/${id}`,
			BASELINE_COLUMN,
		);
		if (
			metric === undefined ||
			baseline === null ||
			metric.direction === "neutral"
		) {
			continue;
		}
		const digits = metricDigits(metric.unit, pack.request.currency);
		if (digits === null) continue;
		chosen.push({
			id,
			label: metric.label[pack.request.language],
			direction: metric.direction,
			metricUnit: metric.unit,
			digits,
			baseline: baseline.value,
			target: sampleTarget(baseline.value, metric.direction, digits),
		});
	}
	if (chosen.length === 0) {
		throw new DataPackError(
			"pack_invalid",
			"the pack has no ALL row with a w28 value for any KPI the sample plan can choose",
		);
	}
	return chosen.map((kpi, index) => ({
		...kpi,
		initiatives: initiativeNumbers().filter(
			(number) => (number - 1) % chosen.length === index,
		),
	}));
}

function initiativeNumbers(): number[] {
	return Array.from({ length: MIN_INITIATIVES }, (_, index) => index + 1);
}

function roundedPlain(value: number, digits: number): string {
	return formatDecimal(roundHalfAwayFromZero(Math.abs(value), digits));
}

function shifted(plain: string, places: number): string {
	const [integer = "0", fraction = ""] = plain.split(".");
	const padded = fraction.padEnd(places, "0");
	const whole = `${integer}${padded.slice(0, places)}`.replace(
		/^0+(?=[0-9])/,
		"",
	);
	const rest = padded.slice(places).replace(/0+$/, "");
	return rest === "" ? whole : `${whole}.${rest}`;
}

function styled(plain: string, language: PackLanguage): string {
	const style = NUMBER_STYLES[language];
	const [integer = "0", fraction = ""] = plain.split(".");
	const grouped = integer.replace(/\B(?=(?:[0-9]{3})+$)/g, style.thousands);
	return fraction === "" ? grouped : `${grouped}${style.decimal}${fraction}`;
}

function amountText(
	value: number,
	digits: number,
	language: PackLanguage,
): string {
	return styled(roundedPlain(value, digits), language);
}

function percentText(value: number, language: PackLanguage): string {
	return `${styled(shifted(roundedPlain(value, PERCENT_DIGITS + 2), 2), language)}%`;
}

function pointsText(value: number, language: PackLanguage): string {
	return `${styled(shifted(roundedPlain(value, PERCENT_DIGITS + 2), 2), language)} ${byLanguage(language, "điểm", "points")}`;
}

function currencyWord(pack: DataPack): string {
	const { currency, language } = pack.request;
	if (currency !== "VND") return currency;
	return byLanguage(language, "đ", "VND");
}

function moneyText(value: number, pack: DataPack): string {
	return `${amountText(value, currencyMinorUnits(pack.request.currency), pack.request.language)} ${currencyWord(pack)}`;
}

function detailText(cell: Cell, pack: DataPack): string | null {
	const { language } = pack.request;
	switch (cell.unit) {
		case "money":
			return moneyText(cell.value, pack);
		case "count":
		case "days":
			return amountText(cell.value, 0, language);
		case "quantity":
			return amountText(cell.value, 3, language);
		case "ratio":
			return amountText(cell.value, 2, language);
		case "hours":
			return amountText(cell.value, 1, language);
		case "fraction":
			return percentText(cell.value, language);
		default:
			return null;
	}
}

function metricText(kpi: SampleKpi, value: number, pack: DataPack): string {
	const { language } = pack.request;
	if (kpi.metricUnit === "fraction") return percentText(value, language);
	const amount = amountText(value, kpi.digits, language);
	return CURRENCY_UNITS.has(kpi.metricUnit)
		? `${amount} ${currencyWord(pack)}`
		: amount;
}

function citation(cell: Cell): string {
	return `[[${cell.ref}]]`;
}

function cited(text: string, cell: Cell): string {
	return `${text} ${citation(cell)}`;
}

function evidenceAt(
	pack: DataPack,
	table: string,
	row: string,
	column: string,
	detail = "",
): Evidence | null {
	const cell = numericCell(pack, table, row, column);
	return cell === null || detailText(cell, pack) === null
		? null
		: { cell, detail };
}

function lastRow(pack: DataPack, table: string): string | null {
	const keys = Object.keys(pack.tables[table]?.rows ?? {})
		.filter((key) => key.startsWith(`${ALL_SCOPE}/`))
		.sort();
	return keys[keys.length - 1] ?? null;
}

const TOP_ITEM: EvidenceSource = {
	find: (pack) => evidenceAt(pack, "items", `${ALL_SCOPE}/r01`, "net"),
	sentence: (language, written, reference) =>
		byLanguage(
			language,
			`Món đứng đầu doanh thu bốn tuần qua mang về ${written} ${reference}.`,
			`The leading item brought in ${written} ${reference} over the last four weeks.`,
		),
};

const QUIETEST_WEEKDAY: EvidenceSource = {
	find: (pack) => {
		let quietest: Evidence | null = null;
		for (const day of WEEKDAYS) {
			const found = evidenceAt(
				pack,
				"weekday",
				`${ALL_SCOPE}/${day}`,
				"share",
				day,
			);
			if (
				found !== null &&
				(quietest === null || found.cell.value < quietest.cell.value)
			) {
				quietest = found;
			}
		}
		return quietest;
	},
	sentence: (language, written, reference) =>
		byLanguage(
			language,
			`Ngày vắng nhất trong tuần chỉ chiếm ${written} ${reference} doanh thu tuần.`,
			`The quietest day of the week holds only ${written} ${reference} of weekly net sales.`,
		),
};

const TOP_PAYMENT: EvidenceSource = {
	find: (pack) => evidenceAt(pack, "payments", `${ALL_SCOPE}/r01`, "share"),
	sentence: (language, written, reference) =>
		byLanguage(
			language,
			`Phương thức thanh toán dùng nhiều nhất chiếm ${written} ${reference} số tiền thu.`,
			`The most used payment method takes ${written} ${reference} of the amount paid.`,
		),
};

const TOP_CATEGORY: EvidenceSource = {
	find: (pack) => evidenceAt(pack, "categories", `${ALL_SCOPE}/r01`, "share"),
	sentence: (language, written, reference) =>
		byLanguage(
			language,
			`Nhóm món dẫn đầu chiếm ${written} ${reference} doanh thu bốn tuần qua.`,
			`The leading category holds ${written} ${reference} of net sales over the last four weeks.`,
		),
};

const MONTH_TO_DATE: EvidenceSource = {
	find: (pack) => evidenceAt(pack, "month_to_date", ALL_SCOPE, "net"),
	sentence: (language, written, reference) =>
		byLanguage(
			language,
			`Doanh thu thuần từ đầu tháng đến nay đạt ${written} ${reference}.`,
			`Net sales for the month to date reached ${written} ${reference}.`,
		),
};

const LAST_WEEK: EvidenceSource = {
	find: (pack) => {
		const row = lastRow(pack, "weekly");
		return row === null ? null : evidenceAt(pack, "weekly", row, "net");
	},
	sentence: (language, written, reference) =>
		byLanguage(
			language,
			`Tuần đầy đủ gần nhất đạt ${written} ${reference} doanh thu thuần.`,
			`The last complete week reached ${written} ${reference} of net sales.`,
		),
};

const FALLBACK_SOURCES: readonly EvidenceSource[] = [
	TOP_ITEM,
	QUIETEST_WEEKDAY,
	TOP_PAYMENT,
	TOP_CATEGORY,
	MONTH_TO_DATE,
	LAST_WEEK,
];

const TEMPLATES: readonly InitiativeTemplate[] = [
	{
		source: TOP_ITEM,
		text: (language, pack) => {
			const name = textCell(pack, "items", `${ALL_SCOPE}/r01`, "name");
			return {
				title: byLanguage(
					language,
					"Đẩy mạnh món dẫn đầu",
					"Push the leading item",
				),
				action: byLanguage(
					language,
					`Đặt ${name ?? "món dẫn đầu doanh thu"} ở đầu thực đơn và gợi ý một món thêm mỗi khi khách gọi món này.`,
					`Put ${name ?? "the leading item"} at the top of the menu and suggest one add-on whenever it is ordered.`,
				),
				effort: byLanguage(
					language,
					"Thấp: chỉ đổi cách trình bày thực đơn và lời gợi ý của thu ngân.",
					"Low: only the menu layout and the cashier's suggestion change.",
				),
				firstStep: byLanguage(
					language,
					"Chọn món thêm để gợi ý và in lại thực đơn.",
					"Choose the add-on to suggest and reprint the menu.",
				),
			};
		},
	},
	{
		source: QUIETEST_WEEKDAY,
		text: (language, _pack, detail) => {
			const day = WEEKDAY_NAMES[language][detail];
			return {
				title: byLanguage(
					language,
					"Kéo khách vào ngày vắng nhất",
					"Bring guests in on the quietest day",
				),
				action: byLanguage(
					language,
					`Chạy một ưu đãi nhỏ vào ${day ?? "ngày vắng nhất"} và báo trước cho khách quen.`,
					`Run a small offer on ${day ?? "the quietest day"} and tell regular guests in advance.`,
				),
				effort: byLanguage(
					language,
					"Trung bình: cần chuẩn bị ưu đãi và nhắc khách.",
					"Medium: the offer has to be prepared and announced.",
				),
				firstStep: byLanguage(
					language,
					"Chọn ưu đãi và ghi lên bảng ở quầy.",
					"Pick the offer and write it on the counter board.",
				),
			};
		},
	},
	{
		source: TOP_PAYMENT,
		text: (language) => ({
			title: byLanguage(
				language,
				"Thanh toán nhanh hơn ở quầy",
				"Faster payment at the counter",
			),
			action: byLanguage(
				language,
				"Đặt mã QR ở mọi quầy và nhắc thu ngân mời khách quét mã.",
				"Place the QR code at every counter and have cashiers offer it.",
			),
			effort: byLanguage(
				language,
				"Thấp: chỉ cần in mã và nhắc ca làm.",
				"Low: print the code and brief each shift.",
			),
			firstStep: byLanguage(
				language,
				"In mã QR cho mọi quầy.",
				"Print the QR code for every counter.",
			),
		}),
	},
	{
		source: TOP_CATEGORY,
		text: (language) => ({
			title: byLanguage(
				language,
				"Mở rộng nhóm món dẫn đầu",
				"Extend the leading category",
			),
			action: byLanguage(
				language,
				"Thử thêm một món mới trong nhóm món dẫn đầu suốt bốn tuần.",
				"Try one new item in the leading category for four weeks.",
			),
			effort: byLanguage(
				language,
				"Trung bình: cần thử công thức và đào tạo pha chế.",
				"Medium: the recipe has to be tested and taught.",
			),
			firstStep: byLanguage(
				language,
				"Chọn món mới và thử công thức với nhân viên.",
				"Choose the new item and test the recipe with the team.",
			),
		}),
	},
	{
		source: MONTH_TO_DATE,
		text: (language) => ({
			title: byLanguage(
				language,
				"Theo dõi tiến độ doanh thu mỗi tuần",
				"Track sales progress every week",
			),
			action: byLanguage(
				language,
				"Đầu mỗi tuần xem lại doanh thu tuần trước trên báo cáo Tuần và điều chỉnh các sáng kiến.",
				"At the start of each week, review last week's sales in the Week report and adjust the initiatives.",
			),
			effort: byLanguage(
				language,
				"Thấp: mười phút mỗi tuần.",
				"Low: ten minutes a week.",
			),
			firstStep: byLanguage(
				language,
				"Đặt lịch nhắc xem báo cáo Tuần.",
				"Set a reminder to read the Week report.",
			),
		}),
	},
];

function heading(section: PlanSectionId, language: PackLanguage): string {
	const found = PLAN_SECTIONS.find((entry) => entry.id === section);
	if (found === undefined) throw new Error(`no section ${section}`);
	return `## ${found.number}. ${found.title[language]}`;
}

function fieldLabel(id: InitiativeFieldId, language: PackLanguage): string {
	const found = INITIATIVE_FIELDS.find((field) => field.id === id);
	if (found === undefined) throw new Error(`no field ${id}`);
	return found.label[language];
}

function field(
	id: InitiativeFieldId,
	language: PackLanguage,
	text: string,
): string {
	return `- **${fieldLabel(id, language)}:** ${text}`;
}

function sampleTitle(language: PackLanguage): string {
	return byLanguage(
		language,
		"Kế hoạch mẫu, tạo tự động để minh họa",
		"Sample plan, generated automatically to illustrate",
	);
}

function frontMatter(pack: DataPack, kpis: readonly SampleKpi[]): string[] {
	const { language, horizon } = pack.request;
	const json = (value: string) => canonicalJson(value).trimEnd();
	const entries = kpis.map((kpi, index) => {
		const comma = index === kpis.length - 1 ? "" : ",";
		return `\t\t${json(kpi.id)}: { "scope": "${ALL_SCOPE}", "baseline": ${formatDecimal(kpi.baseline)}, "target": ${formatDecimal(kpi.target)}, "initiatives": [${kpi.initiatives.join(", ")}] }${comma}`;
	});
	return [
		"---",
		"{",
		`\t"format": ${json(PLAN_FORMAT)},`,
		`\t"pack": ${json(pack.pack_id)},`,
		`\t"title": ${json(sampleTitle(language))},`,
		`\t"horizon": ${json(horizon)},`,
		`\t"language": ${json(language)},`,
		'\t"kpis": {',
		...entries,
		"\t}",
		"}",
		"---",
	];
}

function kpiCell(pack: DataPack, kpi: SampleKpi, column: string): Cell | null {
	return numericCell(pack, KPI_TABLE, `${ALL_SCOPE}/${kpi.id}`, column);
}

function changeClause(pack: DataPack, kpi: SampleKpi): string | null {
	const { language } = pack.request;
	const change = kpiCell(pack, kpi, CHANGE_COLUMN);
	if (
		change === null ||
		roundHalfAwayFromZero(Math.abs(change.value), PERCENT_DIGITS + 2) === 0
	) {
		return null;
	}
	const amount =
		kpi.metricUnit === "fraction"
			? pointsText(change.value, language)
			: percentText(change.value, language);
	const rose = change.value > 0;
	return byLanguage(
		language,
		`${rose ? "tăng" : "giảm"} ${cited(amount, change)} so với bốn tuần trước`,
		`${rose ? "up" : "down"} ${cited(amount, change)} on the four weeks before`,
	);
}

function summaryLines(pack: DataPack, kpis: readonly SampleKpi[]): string[] {
	const { language } = pack.request;
	return kpis.map((kpi) => {
		const baseline = kpiCell(pack, kpi, BASELINE_COLUMN);
		const value =
			baseline === null
				? ""
				: cited(metricText(kpi, baseline.value, pack), baseline);
		const change = changeClause(pack, kpi);
		const lead = byLanguage(
			language,
			`- ${kpi.label} bốn tuần gần nhất là ${value}`,
			`- ${kpi.label} over the last four weeks: ${value}`,
		);
		return `${lead}${change === null ? "" : `, ${change}`}.`;
	});
}

function improved(pack: DataPack, kpi: SampleKpi): boolean {
	const change = kpiCell(pack, kpi, CHANGE_COLUMN);
	if (change === null || change.value === 0) return false;
	return kpi.direction === "higher" ? change.value > 0 : change.value < 0;
}

function strengthLines(pack: DataPack, kpis: readonly SampleKpi[]): string[] {
	const { language } = pack.request;
	return kpis.map((kpi) => {
		const kind = improved(pack, kpi)
			? byLanguage(language, "Điểm mạnh", "Strength")
			: byLanguage(language, "Điểm yếu", "Weakness");
		const verdict = improved(pack, kpi)
			? byLanguage(
					language,
					"đi đúng hướng so với bốn tuần trước",
					"moved the right way against the four weeks before",
				)
			: byLanguage(
					language,
					"chưa đi đúng hướng so với bốn tuần trước",
					"has not moved the right way against the four weeks before",
				);
		const low = kpiCell(pack, kpi, BAND_LOW_COLUMN);
		const high = kpiCell(pack, kpi, BAND_HIGH_COLUMN);
		const band =
			low === null || high === null
				? ""
				: byLanguage(
						language,
						`; các cửa sổ bốn tuần gần đây dao động từ ${cited(metricText(kpi, low.value, pack), low)} đến ${cited(metricText(kpi, high.value, pack), high)}`,
						`; recent four-week windows ranged from ${cited(metricText(kpi, low.value, pack), low)} to ${cited(metricText(kpi, high.value, pack), high)}`,
					);
		return `- ${kind}: ${kpi.label} ${verdict}${band}.`;
	});
}

function evidenceOf(
	pack: DataPack,
	template: InitiativeTemplate,
): { readonly source: EvidenceSource; readonly evidence: Evidence } | null {
	for (const source of [template.source, ...FALLBACK_SOURCES]) {
		const evidence = source.find(pack);
		if (evidence !== null) return { source, evidence };
	}
	return null;
}

function evidenceLine(
	pack: DataPack,
	template: InitiativeTemplate,
	kpi: SampleKpi,
): { readonly text: string; readonly detail: string } {
	const { language } = pack.request;
	const found = evidenceOf(pack, template);
	if (found !== null) {
		const { cell, detail } = found.evidence;
		const written = detailText(cell, pack) ?? "";
		return {
			text: found.source.sentence(language, written, citation(cell)),
			detail,
		};
	}
	const baseline = kpiCell(pack, kpi, BASELINE_COLUMN);
	const value =
		baseline === null
			? ""
			: cited(metricText(kpi, baseline.value, pack), baseline);
	return {
		text: byLanguage(
			language,
			`${kpi.label} bốn tuần gần nhất là ${value}.`,
			`${kpi.label} over the last four weeks: ${value}.`,
		),
		detail: "",
	};
}

function initiativeLines(pack: DataPack, kpis: readonly SampleKpi[]): string[] {
	const { language } = pack.request;
	return TEMPLATES.flatMap((template, index) => {
		const number = index + 1;
		const kpi =
			kpis.find((entry) => entry.initiatives.includes(number)) ?? kpis[0];
		if (kpi === undefined) return [];
		const evidence = evidenceLine(pack, template, kpi);
		const text = template.text(language, pack, evidence.detail);
		const better =
			kpi.direction === "higher"
				? byLanguage(language, "tăng", "higher")
				: byLanguage(language, "giảm", "lower");
		return [
			`### ${INITIATIVE_HEADING[language]} ${number}: ${text.title}`,
			"",
			field("evidence", language, evidence.text),
			field("action", language, text.action),
			field(
				"impact",
				language,
				byLanguage(
					language,
					`Ước tính ${kpi.label} đạt ${metricText(kpi, kpi.target, pack)} vào cuối kỳ, so với ${metricText(kpi, kpi.baseline, pack)} hiện nay.`,
					`Estimate: ${kpi.label} reaches ${metricText(kpi, kpi.target, pack)} by the end of the period, against ${metricText(kpi, kpi.baseline, pack)} now.`,
				),
			),
			field("effort", language, text.effort),
			field("kpi", language, kpi.id),
			field(
				"read",
				language,
				byLanguage(
					language,
					`Tab Kế hoạch, hàng ${kpi.id}; ${better} là tốt.`,
					`Plan tab, row ${kpi.id}; ${better} is better.`,
				),
			),
			field("first_step", language, text.firstStep),
			"",
		];
	});
}

function gapLines(pack: DataPack): string[] {
	const keys = Object.keys(pack.tables.gaps?.rows ?? {})
		.sort()
		.slice(0, GAPS_LISTED);
	return keys.length === 0
		? [
				byLanguage(
					pack.request.language,
					"Gói không báo thiếu dữ liệu nào; giữ các cài đặt như hiện nay.",
					"The pack reports no missing data; keep the settings as they are.",
				),
			]
		: keys.map((key) => `- \`${key}\``);
}

export function samplePlan(pack: DataPack): string {
	const { language } = pack.request;
	const kpis = sampleKpis(pack);
	const title = sampleTitle(language);
	const lines = [
		...frontMatter(pack, kpis),
		"",
		`# ${title}`,
		"",
		byLanguage(
			language,
			"Ứng dụng tạo kế hoạch này tự động từ chính các ô của gói dữ liệu, chỉ để minh họa định dạng; đây không phải lời khuyên kinh doanh.",
			"The app generated this plan automatically from the pack's own cells, only to illustrate the format; it is not business advice.",
		),
		"",
		heading("summary", language),
		"",
		...summaryLines(pack, kpis),
		"",
		heading("strengths_weaknesses", language),
		"",
		...strengthLines(pack, kpis),
		"",
		heading("initiatives", language),
		"",
		...initiativeLines(pack, kpis),
		heading("plan_30_60_90", language),
		"",
		byLanguage(
			language,
			"- Sau 30 ngày: sáng kiến 1 và 2 đã chạy.",
			"- After 30 days: initiatives 1 and 2 are running.",
		),
		byLanguage(
			language,
			"- Sau 60 ngày: thêm sáng kiến 3 và 4.",
			"- After 60 days: initiatives 3 and 4 are added.",
		),
		byLanguage(
			language,
			"- Sau 90 ngày: thêm sáng kiến 5 và so từng KPI với mục tiêu.",
			"- After 90 days: initiative 5 is added and each KPI is compared with its target.",
		),
		"",
		heading("menu", language),
		"",
		byLanguage(
			language,
			"Giữ các món dẫn đầu, xem lại các món bán chậm sau bốn tuần.",
			"Keep the leading items and review the slow sellers after four weeks.",
		),
		"",
		heading("hours_staffing", language),
		"",
		byLanguage(
			language,
			"Bố trí thêm người vào giờ cao điểm theo bảng giờ của gói; giữ ca hiện tại ở giờ vắng.",
			"Add staff in the peak hours that the pack's hour tables show; keep the current shifts in quiet hours.",
		),
		"",
		heading("promotions", language),
		"",
		byLanguage(
			language,
			"Chỉ chạy ưu đãi nêu ở sáng kiến 2, theo đúng các quy định trong phần bối cảnh của gói.",
			"Run only the offer of initiative 2, within the rules in the pack's context.",
		),
		"",
		heading("risks", language),
		"",
		byLanguage(
			language,
			"Ưu đãi có thể kéo giá trị hóa đơn xuống; xem KPI mỗi tuần và dừng sớm nếu đi sai hướng.",
			"An offer can pull the average ticket down; check the KPIs every week and stop early if they move the wrong way.",
		),
		"",
		heading("data_to_collect", language),
		"",
		...gapLines(pack),
		"",
		heading("assumptions", language),
		"",
		byLanguage(
			language,
			"- Đây là kế hoạch mẫu: mục tiêu mỗi KPI lệch 5% so với giá trị bốn tuần gần nhất theo hướng tốt.",
			"- This is a sample: each KPI's target is 5% away from its last four weeks, in the good direction.",
		),
		byLanguage(
			language,
			"- Lượng khách và giá bán giữ như bốn tuần gần nhất.",
			"- Guest numbers and prices stay as in the last four weeks.",
		),
	];
	return `${lines.join("\n")}\n`;
}
