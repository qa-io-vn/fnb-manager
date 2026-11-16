import {
	type CorrectionDelta,
	type FigureChange,
	isEmptyDelta,
	type StoreFigureChange,
} from "../digest/fingerprint.js";
import type { DigestModel } from "../digest/model.js";
import {
	DIGEST_UNIT_LIMITS,
	type DigestRenderOptions,
	renderFindingLines,
} from "./digest.js";
import { createNotifyFormatters, type NotifyFormatters } from "./format.js";
import { emailHtml } from "./html.js";
import { message } from "./template.js";
import { fitToUnits, normalizeText, utf16Units } from "./truncate.js";

const SECTION_SEPARATOR = "\n\n";
const MISSING_FIGURE = "–";
const STORE_STEPS = [5, 3] as const;
const ATTENTION_STEP = 3;

export interface RenderedCorrection {
	readonly title: string;
	readonly text: string;
	readonly html: string | null;
	readonly units: number;
}

interface CorrectionLayout {
	readonly storeLimit: number | null;
	readonly attentionLimit: number | null;
}

function figure(
	format: NotifyFormatters,
	value: number | null,
	kind: "money" | "count",
): string {
	if (value === null) {
		return MISSING_FIGURE;
	}
	return kind === "money" ? format.money(value) : format.count(value);
}

function totalLines(
	format: NotifyFormatters,
	net: FigureChange | null,
	invoices: FigureChange | null,
): string[] {
	const lines: string[] = [];
	if (net !== null) {
		lines.push(
			message("correction.net", {
				net: figure(format, net.new, "money"),
				old: figure(format, net.old, "money"),
			}),
		);
	}
	if (invoices !== null) {
		lines.push(
			message("correction.invoices", {
				invoices: figure(format, invoices.new, "count"),
				old: figure(format, invoices.old, "count"),
			}),
		);
	}
	return lines;
}

function storeLine(format: NotifyFormatters, store: StoreFigureChange): string {
	return message("correction.store", {
		store: store.name,
		net: figure(format, store.net.new, "money"),
		invoices: figure(format, store.invoices.new, "count"),
		oldNet: figure(format, store.net.old, "money"),
		oldInvoices: figure(format, store.invoices.old, "count"),
	});
}

function limited(
	lines: readonly string[],
	limit: number | null,
	more: (count: number) => string,
): string[] {
	if (limit === null || lines.length <= limit) {
		return [...lines];
	}
	return [...lines.slice(0, limit), more(lines.length - limit)];
}

function joinSections(sections: readonly (readonly string[])[]): string {
	return normalizeText(
		sections
			.filter((section) => section.length > 0)
			.map((section) => section.join("\n"))
			.join(SECTION_SEPARATOR),
	);
}

function assemble(
	delta: CorrectionDelta,
	model: DigestModel,
	options: DigestRenderOptions,
	format: NotifyFormatters,
	layout: CorrectionLayout,
): string {
	const header = [
		message("correction.title", { date: format.date(model.businessDate) }),
	];
	const stores =
		model.stores.length >= 2
			? delta.stores.map((store) => storeLine(format, store))
			: [];
	const figures = [
		...totalLines(format, delta.net, delta.invoices),
		...limited(stores, layout.storeLimit, (count) =>
			message("digest.stores.more", { count }),
		),
	];
	const changes =
		figures.length === 0 ? [] : [message("correction.intro"), ...figures];
	const findings = renderFindingLines(model, delta.newFindings, options);
	const attention =
		findings.length === 0
			? []
			: [
					message("correction.attention", { count: findings.length }),
					...limited(findings, layout.attentionLimit, (count) =>
						message("digest.attention.more", { count }),
					),
				];
	const footer: string[] = [];
	const base = options.appBaseUrl;
	if (base !== null && base !== "" && model.link.kind === "ngay") {
		footer.push(
			message("digest.link.ngay", { url: `${base}${model.link.path}` }),
		);
	}
	footer.push(message("digest.footer"));
	return joinSections([header, changes, attention, footer]);
}

export function renderCorrection(
	delta: CorrectionDelta,
	model: DigestModel,
	options: DigestRenderOptions,
): RenderedCorrection | null {
	if (isEmptyDelta(delta)) {
		return null;
	}
	const format = createNotifyFormatters({
		currencyCode: options.currencyCode,
		timeZone: options.timeZone,
	});
	const maxUnits = options.maxUnits ?? DIGEST_UNIT_LIMITS[options.channel];
	const layouts: CorrectionLayout[] = [
		{ storeLimit: null, attentionLimit: null },
		...STORE_STEPS.map((storeLimit) => ({ storeLimit, attentionLimit: null })),
		{
			storeLimit: STORE_STEPS[STORE_STEPS.length - 1] ?? 3,
			attentionLimit: ATTENTION_STEP,
		},
	];
	let text = "";
	for (const layout of layouts) {
		text = assemble(delta, model, options, format, layout);
		if (utf16Units(text) <= maxUnits) {
			break;
		}
	}
	text = fitToUnits(text, maxUnits);
	const title =
		options.channel === "email"
			? message("correction.title", { date: format.date(model.businessDate) })
			: (text.split("\n")[0] ?? "");
	return {
		title,
		text,
		html:
			options.channel === "email" ? emailHtml("digest_correction", text) : null,
		units: utf16Units(text),
	};
}
