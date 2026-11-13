import type {
	DigestComparison,
	DigestFinding,
	DigestModel,
	DigestOpenAlert,
	DigestStoreLine,
} from "../digest/model.js";
import type { MessageKey } from "../messages/vi.js";
import type { DayRuleKey } from "../rules/day.js";
import {
	createNotifyFormatters,
	formatClockTime,
	formatViDate,
	localIsoDate,
	type NotifyFormatters,
} from "./format.js";
import { emailHtml } from "./html.js";
import { message } from "./template.js";
import { fitToUnits, normalizeText, utf16Units } from "./truncate.js";

export type DigestChannel = "zalo_bot" | "telegram" | "email";

export const DIGEST_UNIT_LIMITS: Readonly<Record<DigestChannel, number>> = {
	zalo_bot: 1900,
	telegram: 4000,
	email: 8000,
};

export const FULL_BASELINE_SAMPLE = 8;
export const STATE_LINE_STORE_NAMES = 3;

const SECTION_SEPARATOR = "\n\n";
const CUT_MARK = "…";

export interface DigestRenderOptions {
	readonly channel: DigestChannel;
	readonly appBaseUrl: string | null;
	readonly timeZone: string;
	readonly currencyCode: string;
	readonly maxUnits?: number;
}

export interface RenderedDigest {
	readonly title: string;
	readonly text: string;
	readonly html: string | null;
	readonly units: number;
	readonly truncation: readonly TruncationStep[];
}

export type TruncationStep =
	| "top_items"
	| "peak_hour"
	| "stores_5"
	| "stores_3"
	| "attention_3"
	| "open_alerts"
	| "hard_cut";

const FINDING_ORDER: readonly DayRuleKey[] = [
	"unverified_day",
	"zero_sales_day",
	"revenue_below_baseline",
	"ticket_drop",
	"drawer_variance",
];

const STORE_STATE_KEYS: Readonly<
	Partial<Record<DigestStoreLine["state"], MessageKey>>
> = {
	closed: "digest.stores.closed",
	no_sales: "digest.stores.noSales",
	unsettled: "digest.stores.unsettled",
};

interface Layout {
	topItems: boolean;
	peakHour: boolean;
	storeLimit: number | null;
	attentionLimit: number | null;
	openAlerts: boolean;
}

interface RenderContext {
	readonly model: DigestModel;
	readonly options: DigestRenderOptions;
	readonly format: NotifyFormatters;
	readonly storeNames: ReadonlyMap<string, string>;
}

function percentText(fraction: number): string {
	const scaled = Math.round(fraction * 1000) / 10;
	const whole = Math.round(scaled);
	return Math.abs(scaled - whole) < 1e-9
		? `${whole}%`
		: `${scaled.toFixed(1).replace(".", ",")}%`;
}

function numberValue(value: number | string | undefined): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function textValue(value: number | string | undefined, fallback = ""): string {
	return value === undefined ? fallback : String(value);
}

function storeName(context: RenderContext, storeId: string | null): string {
	return storeId === null
		? "cửa hàng"
		: (context.storeNames.get(storeId) ?? "cửa hàng");
}

function scopeText(context: RenderContext): string {
	const { model } = context;
	const count = model.stores.length;
	if (model.scope.allStores && count > 1) {
		return message("digest.scope.all", { count });
	}
	const [only] = model.stores;
	if (count === 1 && only !== undefined) {
		return message("digest.scope.one", { store: only.name });
	}
	return message(
		model.scope.allStores ? "digest.scope.all" : "digest.scope.some",
		{
			count,
		},
	);
}

function namesWith(
	model: DigestModel,
	states: readonly DigestStoreLine["state"][],
): string {
	const names = model.stores
		.filter((store) => states.includes(store.state))
		.map((store) => store.name);
	if (names.length <= STATE_LINE_STORE_NAMES) {
		return names.join(", ");
	}
	return message("digest.state.stores.more", {
		stores: names.slice(0, STATE_LINE_STORE_NAMES).join(", "),
		count: names.length - STATE_LINE_STORE_NAMES,
	});
}

function builtTime(context: RenderContext): string {
	return formatClockTime(
		new Date(context.model.builtAt),
		context.options.timeZone,
	);
}

function stateText(context: RenderContext): string | null {
	const { model } = context;
	switch (model.dataState) {
		case "verified":
			return message("digest.state.verified");
		case "unverified":
			return message("digest.state.unverified");
		case "unmatched":
			return message("digest.state.unmatched", {
				stores: namesWith(model, ["unmatched"]),
			});
		case "partial":
			return message("digest.state.partial", {
				stores: namesWith(model, ["unsettled", "shift_open"]),
				time: builtTime(context),
			});
		case "no_data":
			return null;
	}
}

function headerLines(context: RenderContext): string[] {
	const { model, format } = context;
	const date = format.date(model.businessDate);
	const lines = [
		message("digest.title", {
			date,
			weekday: format.weekday(model.businessDate),
		}),
	];
	const state = stateText(context);
	lines.push(
		state === null ? scopeText(context) : `${scopeText(context)} · ${state}`,
	);
	if (model.dataState === "no_data") {
		lines.push(message("digest.state.no_data", { date }));
	}
	if (model.holidayKind !== null) {
		lines.push(
			message("digest.holiday", {
				kind: message(
					model.holidayKind === "tet"
						? "digest.holiday.tet"
						: "digest.holiday.holiday",
				),
			}),
		);
	}
	if (model.stale) {
		lines.push(message("digest.stale"));
	}
	return lines;
}

function baselineLine(
	context: RenderContext,
	comparison: DigestComparison,
): string {
	if (comparison.change === null) {
		return message("digest.vsBaseline.building");
	}
	const change = context.format.signedPercent(comparison.change);
	return comparison.sampleDays !== null &&
		comparison.sampleDays < FULL_BASELINE_SAMPLE
		? message("digest.vsBaseline.partial", {
				weeks: comparison.sampleDays,
				change,
			})
		: message("digest.vsBaseline", { change });
}

function previousLine(
	context: RenderContext,
	comparison: DigestComparison,
): string {
	const change = context.format.signedPercent(comparison.change ?? 0);
	if (
		comparison.basis === "like_for_like" &&
		comparison.coveredStores !== undefined &&
		comparison.totalStores !== undefined
	) {
		return message("digest.vsPrevious.likeForLike", {
			covered: comparison.coveredStores,
			total: comparison.totalStores,
			change,
		});
	}
	return message("digest.vsPrevious", { change });
}

function headlineLines(context: RenderContext, layout: Layout): string[] {
	const { model, format } = context;
	if (model.dataState === "no_data") {
		return [];
	}
	const { totals } = model;
	const lines = [
		message("digest.net", { net: format.money(totals.net ?? 0) }),
		baselineLine(context, totals.vsBaseline),
	];
	if (totals.vsPrevious.change !== null) {
		lines.push(previousLine(context, totals.vsPrevious));
	}
	const invoices = format.count(totals.invoices ?? 0);
	lines.push(
		totals.avgTicket === null
			? message("digest.invoices.only", { invoices })
			: message("digest.invoices", {
					invoices,
					ticket: format.money(totals.avgTicket),
				}),
	);
	if (totals.cashToCount !== null) {
		lines.push(
			message("digest.cash", { cash: format.money(totals.cashToCount) }),
		);
	}
	if (
		layout.peakHour &&
		totals.peakHour !== null &&
		totals.peakHour.net !== null
	) {
		lines.push(
			message("digest.peak", {
				hour: totals.peakHour.hour,
				net: format.money(totals.peakHour.net),
			}),
		);
	}
	if (layout.topItems && totals.topItems.length > 0) {
		lines.push(
			message("digest.topItems", {
				items: totals.topItems
					.map((item) =>
						message("digest.topItem", {
							item: item.name,
							quantity:
								item.quantity === null ? "–" : format.count(item.quantity),
						}),
					)
					.join(", "),
			}),
		);
	}
	return lines;
}

function storeLine(context: RenderContext, store: DigestStoreLine): string {
	const key = STORE_STATE_KEYS[store.state];
	if (key !== undefined) {
		return message(key, { store: store.name });
	}
	if (store.state === "shift_open") {
		return message("digest.stores.shiftOpen", {
			store: store.name,
			time: builtTime(context),
		});
	}
	const net = context.format.money(store.net ?? 0);
	const { change, sampleDays } = store.vsBaseline;
	if (change === null) {
		return message("digest.stores.line.building", { store: store.name, net });
	}
	const changeText = context.format.signedPercent(change);
	return sampleDays !== null && sampleDays < FULL_BASELINE_SAMPLE
		? message("digest.stores.line.partial", {
				store: store.name,
				net,
				change: changeText,
				weeks: sampleDays,
			})
		: message("digest.stores.line", {
				store: store.name,
				net,
				change: changeText,
			});
}

function storeLines(context: RenderContext, layout: Layout): string[] {
	const { stores } = context.model;
	if (stores.length < 2) {
		return [];
	}
	const limit = layout.storeLimit;
	const shown =
		limit === null || stores.length <= limit ? stores : stores.slice(0, limit);
	const lines = [
		message("digest.stores.title"),
		...shown.map((store) => storeLine(context, store)),
	];
	if (shown.length < stores.length) {
		lines.push(
			message("digest.stores.more", { count: stores.length - shown.length }),
		);
	}
	return lines;
}

function shiftLabel(values: DigestFinding["values"]): string {
	const number = numberValue(values.shift_number);
	return number !== null && Number.isInteger(number) && number > 0
		? message("digest.finding.drawer_variance.shift", { number })
		: message("digest.finding.drawer_variance.shift.unknown");
}

function findingLine(context: RenderContext, finding: DigestFinding): string {
	const store = storeName(context, finding.storeId);
	const { values } = finding;
	const { format } = context;
	switch (finding.ruleKey) {
		case "revenue_below_baseline":
			return message("digest.finding.revenue_below_baseline", {
				store,
				ratio: percentText(numberValue(values.ratio) ?? 0),
				threshold: percentText(numberValue(values.threshold) ?? 0),
			});
		case "ticket_drop":
			return message("digest.finding.ticket_drop", {
				store,
				ticket: format.money(numberValue(values.ticket) ?? 0),
				drop: percentText(numberValue(values.drop) ?? 0),
				reference: message(
					values.reference === "previous"
						? "digest.finding.ticket_drop.previous"
						: "digest.finding.ticket_drop.baseline",
				),
			});
		case "drawer_variance":
			return message("digest.finding.drawer_variance", {
				store,
				shift: shiftLabel(values),
				from: textValue(values.from, "…"),
				to: textValue(values.to, "…"),
				variance: format.money(numberValue(values.variance) ?? 0),
			});
		case "unverified_day":
			return message(
				values.variant === "unmatched"
					? "digest.finding.unverified_day.unmatched"
					: "digest.finding.unverified_day.unchecked",
				{ store },
			);
		case "zero_sales_day":
			return message("digest.finding.zero_sales_day", { store });
	}
}

function orderedFindings(context: RenderContext): DigestFinding[] {
	const storeOrder = new Map(
		context.model.stores.map((store, index) => [store.storeId, index]),
	);
	const rank = (finding: DigestFinding) =>
		numberValue(finding.values.rank) ?? 0;
	return [...context.model.findings].sort(
		(left, right) =>
			FINDING_ORDER.indexOf(left.ruleKey) -
				FINDING_ORDER.indexOf(right.ruleKey) ||
			(storeOrder.get(left.storeId) ?? 0) -
				(storeOrder.get(right.storeId) ?? 0) ||
			rank(left) - rank(right),
	);
}

interface AttentionEntry {
	readonly text: string;
	readonly findings: number;
}

function isHiddenDrawerLine(finding: DigestFinding): boolean {
	if (finding.ruleKey !== "drawer_variance") {
		return false;
	}
	const rank = numberValue(finding.values.rank) ?? 1;
	const maxLines = numberValue(finding.values.max_lines) ?? 3;
	return rank > maxLines;
}

function attentionEntries(
	context: RenderContext,
	findings: readonly DigestFinding[],
): AttentionEntry[] {
	const hidden = new Map<string, number>();
	for (const finding of findings) {
		if (isHiddenDrawerLine(finding)) {
			hidden.set(finding.storeId, (hidden.get(finding.storeId) ?? 0) + 1);
		}
	}
	const entries: AttentionEntry[] = [];
	const summarised = new Set<string>();
	for (const finding of findings) {
		if (!isHiddenDrawerLine(finding)) {
			entries.push({ text: findingLine(context, finding), findings: 1 });
			continue;
		}
		if (summarised.has(finding.storeId)) {
			continue;
		}
		summarised.add(finding.storeId);
		const count = hidden.get(finding.storeId) ?? 0;
		entries.push({
			text: message("digest.finding.drawer_variance.more", {
				store: storeName(context, finding.storeId),
				count,
			}),
			findings: count,
		});
	}
	return entries;
}

function attentionLines(context: RenderContext, layout: Layout): string[] {
	const findings = orderedFindings(context);
	if (findings.length === 0) {
		return [];
	}
	const entries = attentionEntries(context, findings);
	const limit = layout.attentionLimit;
	const shown =
		limit === null || entries.length <= limit
			? entries
			: entries.slice(0, limit);
	const result = [
		message("digest.attention.title", { count: findings.length }),
		...shown.map((entry) => entry.text),
	];
	const cut = entries.slice(shown.length);
	if (cut.length > 0) {
		result.push(
			message("digest.attention.more", {
				count: cut.reduce((sum, entry) => sum + entry.findings, 0),
			}),
		);
	}
	return result;
}

function shortDate(instant: Date, timeZone: string): string {
	return formatViDate(localIsoDate(instant, timeZone)).slice(0, 5);
}

function openAlertLine(
	context: RenderContext,
	alert: DigestOpenAlert,
): string | null {
	const opened = new Date(alert.openedAt);
	if (Number.isNaN(opened.getTime())) {
		return null;
	}
	const zone = context.options.timeZone;
	const date = shortDate(opened, zone);
	const account = alert.accountName ?? "tài khoản POS";
	switch (alert.ruleKey) {
		case "auth_failed":
			return message("digest.open.auth_failed", { account, date });
		case "sync_stale":
			return message("digest.open.sync_stale", {
				store: storeName(context, alert.storeId),
				time: formatClockTime(opened, zone),
				date,
			});
		case "sync_failed":
			return message("digest.open.sync_failed", {
				subject:
					alert.storeId !== null
						? storeName(context, alert.storeId)
						: alert.runKind === null
							? account
							: `${account} (${alert.runKind})`,
				date,
			});
		default:
			return null;
	}
}

function openAlertLines(context: RenderContext, layout: Layout): string[] {
	if (!layout.openAlerts) {
		return [];
	}
	const lines = context.model.openAlerts.flatMap((alert) => {
		const line = openAlertLine(context, alert);
		return line === null ? [] : [line];
	});
	return lines.length === 0 ? [] : [message("digest.open.title"), ...lines];
}

function footerLines(context: RenderContext): string[] {
	const lines: string[] = [];
	const base = context.options.appBaseUrl;
	if (base !== null && base !== "") {
		const url = `${base}${context.model.link.path}`;
		lines.push(
			context.model.link.kind === "ngay"
				? message("digest.link.ngay", { url })
				: message("digest.link.today", { url }),
		);
	}
	lines.push(message("digest.footer"));
	return lines;
}

interface DigestParts {
	readonly head: string;
	readonly body: string;
	readonly tail: string;
}

function joinSections(sections: readonly (readonly string[])[]): string {
	return normalizeText(
		sections
			.filter((section) => section.length > 0)
			.map((section) => section.join("\n"))
			.join(SECTION_SEPARATOR),
	);
}

function digestParts(context: RenderContext, layout: Layout): DigestParts {
	return {
		head: joinSections([headerLines(context), headlineLines(context, layout)]),
		body: joinSections([
			storeLines(context, layout),
			attentionLines(context, layout),
			openAlertLines(context, layout),
		]),
		tail: joinSections([footerLines(context)]),
	};
}

function joinParts(parts: readonly string[]): string {
	return parts.filter((part) => part !== "").join(SECTION_SEPARATOR);
}

function assemble(context: RenderContext, layout: Layout): string {
	const { head, body, tail } = digestParts(context, layout);
	return joinParts([head, body, tail]);
}

function cutBody(body: string, room: number): string {
	if (utf16Units(body) <= room) {
		return body;
	}
	const lines = body.split("\n");
	while (lines.length > 0) {
		lines.pop();
		while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") {
			lines.pop();
		}
		const candidate =
			lines.length === 0 ? CUT_MARK : `${lines.join("\n")}\n${CUT_MARK}`;
		if (utf16Units(candidate) <= room) {
			return candidate;
		}
	}
	return "";
}

function hardCut(
	context: RenderContext,
	layout: Layout,
	maxUnits: number,
): string {
	const { head, body, tail } = digestParts(context, layout);
	const fixed = utf16Units(head) + utf16Units(tail) + SECTION_SEPARATOR.length;
	const room = maxUnits - fixed - SECTION_SEPARATOR.length;
	const kept = room > 0 && body !== "" ? cutBody(body, room) : "";
	const text = joinParts([head, kept, tail]);
	if (utf16Units(text) <= maxUnits) {
		return text;
	}
	const headRoom = maxUnits - utf16Units(tail) - SECTION_SEPARATOR.length;
	return headRoom > CUT_MARK.length
		? joinParts([fitToUnits(head, headRoom), tail])
		: fitToUnits(text, maxUnits);
}

const STEPS: readonly {
	readonly step: Exclude<TruncationStep, "hard_cut">;
	readonly apply: (layout: Layout) => Layout;
}[] = [
	{ step: "top_items", apply: (layout) => ({ ...layout, topItems: false }) },
	{ step: "peak_hour", apply: (layout) => ({ ...layout, peakHour: false }) },
	{ step: "stores_5", apply: (layout) => ({ ...layout, storeLimit: 5 }) },
	{ step: "stores_3", apply: (layout) => ({ ...layout, storeLimit: 3 }) },
	{
		step: "attention_3",
		apply: (layout) => ({ ...layout, attentionLimit: 3 }),
	},
	{
		step: "open_alerts",
		apply: (layout) => ({ ...layout, openAlerts: false }),
	},
];

export function digestSubject(
	model: DigestModel,
	options: Pick<DigestRenderOptions, "currencyCode" | "timeZone">,
): string {
	const context: RenderContext = {
		model,
		options: { ...options, channel: "email", appBaseUrl: null },
		format: createNotifyFormatters(options),
		storeNames: new Map(
			model.stores.map((store) => [store.storeId, store.name]),
		),
	};
	return message("digest.subject", {
		date: context.format.date(model.businessDate),
		scope: scopeText(context),
	});
}

export function renderDigest(
	model: DigestModel,
	options: DigestRenderOptions,
): RenderedDigest {
	const context: RenderContext = {
		model,
		options,
		format: createNotifyFormatters({
			currencyCode: options.currencyCode,
			timeZone: options.timeZone,
		}),
		storeNames: new Map(
			model.stores.map((store) => [store.storeId, store.name]),
		),
	};
	const maxUnits = options.maxUnits ?? DIGEST_UNIT_LIMITS[options.channel];
	let layout: Layout = {
		topItems: true,
		peakHour: true,
		storeLimit: null,
		attentionLimit: null,
		openAlerts: true,
	};
	const applied: TruncationStep[] = [];
	let text = assemble(context, layout);
	for (const { step, apply } of STEPS) {
		if (utf16Units(text) <= maxUnits) {
			break;
		}
		layout = apply(layout);
		applied.push(step);
		text = assemble(context, layout);
	}
	if (utf16Units(text) > maxUnits) {
		applied.push("hard_cut");
		text = hardCut(context, layout, maxUnits);
	}
	const title =
		options.channel === "email"
			? digestSubject(model, options)
			: (text.split("\n")[0] ?? "");
	return {
		title,
		text,
		html: options.channel === "email" ? emailHtml("digest", text) : null,
		units: utf16Units(text),
		truncation: applied,
	};
}
