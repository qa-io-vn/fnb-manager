import {
	type CanonicalLine,
	type LineKind,
	parseSizeSuffix,
	roundMoney,
} from "@fnb/core";
import type { InvoiceLine } from "../schemas/accounting.js";
import {
	isCustomisationOption,
	isPricedInMaster,
	type MasterIndex,
	resolveItemClassName,
	resolveItemType,
	resolveUnitName,
} from "./master-index.js";
import type { ResolvedIposOptions } from "./options.js";

export interface MappedLines {
	lines: CanonicalLine[];
	unknownItemIds: string[];
	untypedItemNames: string[];
}

function isZeroMoney(row: InvoiceLine): boolean {
	return row.amount === 0 && row.price === 0;
}

function isPackageComponent(row: InvoiceLine): boolean {
	const packageId = row.package_id?.trim();
	return Boolean(packageId) && packageId !== row.item_id;
}

export function classifyLine(row: InvoiceLine, index: MasterIndex): LineKind {
	if (isCustomisationOption(index, row)) {
		return isZeroMoney(row) && !isPricedInMaster(index, row.item_id)
			? "modifier"
			: "item";
	}
	if (index.itemsByKey.has(row.item_id)) {
		return isPackageComponent(row) ? "package_component" : "item";
	}
	if (isZeroMoney(row)) {
		return "modifier";
	}
	return isPackageComponent(row) ? "package_component" : "item";
}

export function sortByIndex(rows: readonly InvoiceLine[]): InvoiceLine[] {
	return rows
		.map((row, position) => ({ row, position }))
		.sort(
			(left, right) =>
				(left.row.index ?? left.position) -
					(right.row.index ?? right.position) || left.position - right.position,
		)
		.map((entry) => entry.row);
}

export function compositeParentId(
	lineId: string,
	knownIds: ReadonlySet<string>,
): string | undefined {
	const separator = lineId.indexOf("_");
	if (separator <= 0) {
		return undefined;
	}
	const prefix = lineId.slice(0, separator);
	return prefix !== lineId && knownIds.has(prefix) ? prefix : undefined;
}

function nearestItemLine(
	lines: readonly CanonicalLine[],
	position: number,
): string | undefined {
	for (let cursor = position - 1; cursor >= 0; cursor -= 1) {
		const candidate = lines[cursor];
		if (candidate && candidate.lineKind !== "modifier") {
			return candidate.externalId;
		}
	}
	for (let cursor = position + 1; cursor < lines.length; cursor += 1) {
		const candidate = lines[cursor];
		if (candidate && candidate.lineKind !== "modifier") {
			return candidate.externalId;
		}
	}
	return undefined;
}

function toCanonicalLine(
	row: InvoiceLine,
	lineKind: LineKind,
	index: MasterIndex,
	options: ResolvedIposOptions,
): CanonicalLine {
	const { baseName, sizeLabel } = parseSizeSuffix(
		row.item_name,
		options.sizeLabels,
	);
	const itemType = resolveItemType(index, row);
	const lineDiscount = row.discount_amount ?? 0;
	const priceDiscount = row.amount_discount_on_price ?? 0;
	const discountAmount = roundMoney(lineDiscount + priceDiscount);
	return {
		externalId: row.id,
		lineKind,
		itemExternalId: row.item_id,
		itemName: row.item_name,
		baseName,
		sizeLabel,
		itemTypeExternalId: itemType.externalId,
		itemTypeName: itemType.name,
		itemClassName: resolveItemClassName(index, row),
		unitName: resolveUnitName(index, row.unit_id),
		quantity: row.quantity,
		unitPrice: row.price,
		grossAmount: roundMoney(row.amount + discountAmount),
		discountAmount,
		netAmount: row.amount,
		promotionExternalId: row.promotion_id?.trim() || undefined,
		promotionName: row.promotion_name?.trim() || undefined,
		note: row.item_note?.trim() || undefined,
		raw: row,
	};
}

export function mapInvoiceLines(
	rows: readonly InvoiceLine[],
	index: MasterIndex,
	options: ResolvedIposOptions,
): MappedLines {
	const ordered = sortByIndex(rows);
	const knownIds = new Set(ordered.map((row) => row.id));
	const lines = ordered.map((row) =>
		toCanonicalLine(row, classifyLine(row, index), index, options),
	);
	const unknownItemIds: string[] = [];
	const untypedItemNames: string[] = [];
	lines.forEach((line, position) => {
		const row = ordered[position];
		if (!row) {
			return;
		}
		const parent =
			compositeParentId(row.id, knownIds) ??
			(line.lineKind === "modifier"
				? nearestItemLine(lines, position)
				: undefined);
		if (parent !== undefined && parent !== line.externalId) {
			line.parentLineExternalId = parent;
		}
		if (line.lineKind === "modifier") {
			return;
		}
		if (!index.itemsByKey.has(row.item_id)) {
			unknownItemIds.push(row.item_id);
		}
		if (line.itemTypeName === undefined) {
			untypedItemNames.push(row.item_name);
		}
	});
	return { lines, unknownItemIds, untypedItemNames };
}
