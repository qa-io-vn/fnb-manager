import { type CardModel, isLabelKey, type SentencePart } from "@fnb/reports";

export function partKeys(part: SentencePart | null): string[] {
	if (part === null) return [];
	return [
		part.key,
		...Object.values(part.values).flatMap((value) =>
			value.kind === "message"
				? [value.value]
				: value.kind === "part"
					? partKeys(value.value)
					: [],
		),
	];
}

export function modelKeys(card: CardModel): string[] {
	return [
		card.titleKey,
		...partKeys(card.subtitle),
		...partKeys(card.headline.caption),
		...partKeys(card.notice?.part ?? null),
		...card.narrative.flatMap(partKeys),
		...card.comparisons.flatMap((comparison) => [
			...partKeys(comparison.label),
			...(comparison.unavailable === null
				? []
				: [`report.unavailable.${comparison.unavailable}.${comparison.kind}`]),
		]),
		...(card.decomposition === null
			? []
			: [
					card.decomposition.metric === "net_revenue"
						? "report.decomposition.net"
						: "report.decomposition.ticket",
				]),
		...card.tables.flatMap((table) => [
			table.captionKey,
			...table.columns.map((column) => column.labelKey),
			...table.columns
				.filter((column) => column.kind === "message")
				.flatMap((column) =>
					table.rows.flatMap((row) => {
						const cell = row.cells[column.key];
						return typeof cell === "string" ? [cell] : [];
					}),
				),
			...table.columns
				.filter((column) => column.kind === "label")
				.flatMap((column) =>
					table.rows.flatMap((row) => {
						const cell = row.cells[column.key];
						return isLabelKey(cell) ? [cell] : [];
					}),
				),
		]),
		...(card.chart === null
			? []
			: [
					card.chart.labelKey,
					...card.chart.series.flatMap((series) => partKeys(series.label)),
					...card.chart.markLines.flatMap((line) => partKeys(line.label)),
					...card.chart.markAreas.flatMap((area) => partKeys(area.label)),
					...card.chart.categories.flatMap((category) =>
						category.kind === "message" ? [category.value] : [],
					),
				]),
	];
}
