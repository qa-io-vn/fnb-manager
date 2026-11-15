import type {
	DemoItemCost,
	DemoLegalDocument,
	DemoSettingsStore,
	DemoTarget,
} from "@fnb/demo-analytics";
import {
	byKeys,
	demoAuditOf,
	demoRowId,
	demoWrite,
	forgetDemoSaved,
	markDemoSaved,
	requireUniqueKeys,
} from "../demo-writes";
import { SettingsWriteError } from "../source";
import {
	type ItemCostChange,
	type ItemCostRow,
	type LegalDocumentRow,
	legalStatusOf,
	type ManualSettingsSource,
	type TargetChange,
	type TargetRow,
} from "./source";

function costId(cost: ItemCostChange | DemoItemCost): string {
	return demoRowId(
		"cost",
		cost.storeId,
		cost.itemExternalId,
		cost.effectiveFrom,
	);
}

function targetId(target: TargetChange | DemoTarget): string {
	return demoRowId(
		"target",
		target.storeId,
		target.periodKind,
		target.periodStart,
	);
}

function legalId(document: DemoLegalDocument): string {
	return demoRowId(
		"legal",
		document.kind,
		document.language,
		document.versionLabel,
	);
}

const costOrder = byKeys<DemoItemCost>(
	(cost) => cost.itemExternalId,
	(cost) => cost.storeId,
	(cost) => cost.effectiveFrom,
);

const targetOrder = byKeys<DemoTarget>(
	(target) => target.storeId,
	(target) => target.periodKind,
	(target) => target.periodStart,
);

const legalOrder = byKeys<DemoLegalDocument>(
	(document) => document.kind,
	(document) => document.language,
	(document) => document.versionLabel,
);

function costRowOf(store: DemoSettingsStore, cost: DemoItemCost): ItemCostRow {
	const id = costId(cost);
	return { ...cost, id, audit: demoAuditOf(store, id) };
}

function targetRowOf(store: DemoSettingsStore, target: DemoTarget): TargetRow {
	const id = targetId(target);
	return { ...target, id, audit: demoAuditOf(store, id) };
}

function legalRowOf(
	store: DemoSettingsStore,
	document: DemoLegalDocument,
): LegalDocumentRow {
	const id = legalId(document);
	return {
		id,
		kind: document.kind,
		language: document.language === "en" ? "en" : "vi",
		version: document.versionLabel,
		title: document.title,
		bodyMarkdown: document.body,
		status: legalStatusOf(document.publishedAt, document.retiredAt),
		publishedAt: document.publishedAt,
		retiredAt: document.retiredAt,
		audit: demoAuditOf(store, id),
	};
}

export function createDemoManualSource(
	store: DemoSettingsStore,
	now: () => Date = () => new Date(),
): ManualSettingsSource {
	const documentOf = (id: string): DemoLegalDocument => {
		const document = store
			.legalDocuments()
			.find((candidate) => legalId(candidate) === id);
		if (document === undefined) throw new SettingsWriteError("forbidden");
		return document;
	};

	const saveDocuments = (
		documents: readonly DemoLegalDocument[],
		touched: readonly DemoLegalDocument[],
	) => {
		demoWrite(() => store.saveLegalDocuments(documents));
		markDemoSaved(store, touched.map(legalId), now());
	};

	return {
		kind: "demo",

		async itemCosts(): Promise<ItemCostRow[]> {
			return [...store.costs()]
				.sort(costOrder)
				.map((cost) => costRowOf(store, cost));
		},

		async saveItemCosts(_tenantId, rows): Promise<ItemCostRow[]> {
			requireUniqueKeys(rows, costId);
			const next = new Map(store.costs().map((cost) => [costId(cost), cost]));
			for (const row of rows) next.set(costId(row), { ...row });
			demoWrite(() => store.saveCosts([...next.values()]));
			markDemoSaved(store, rows.map(costId), now());
			const ids = new Set(rows.map(costId));
			return [...store.costs()]
				.sort(costOrder)
				.filter((cost) => ids.has(costId(cost)))
				.map((cost) => costRowOf(store, cost));
		},

		async deleteItemCost(_tenantId, id) {
			const kept = store.costs().filter((cost) => costId(cost) !== id);
			if (kept.length === store.costs().length) return;
			demoWrite(() => store.saveCosts(kept));
			forgetDemoSaved(store, [id]);
		},

		async targets(): Promise<TargetRow[]> {
			return [...store.targets()]
				.sort(targetOrder)
				.map((target) => targetRowOf(store, target));
		},

		async saveTargets(_tenantId, rows): Promise<TargetRow[]> {
			requireUniqueKeys(rows, targetId);
			const next = new Map(
				store.targets().map((target) => [targetId(target), target]),
			);
			for (const row of rows) next.set(targetId(row), { ...row });
			demoWrite(() => store.saveTargets([...next.values()]));
			markDemoSaved(store, rows.map(targetId), now());
			const ids = new Set(rows.map(targetId));
			return [...store.targets()]
				.sort(targetOrder)
				.filter((target) => ids.has(targetId(target)))
				.map((target) => targetRowOf(store, target));
		},

		async legalDocuments(): Promise<LegalDocumentRow[]> {
			return [...store.legalDocuments()]
				.sort(legalOrder)
				.map((document) => legalRowOf(store, document));
		},

		async saveLegalDraft(_tenantId, change): Promise<LegalDocumentRow> {
			const documents = store.legalDocuments();
			const before =
				change.id === undefined ? undefined : documentOf(change.id);
			const saved: DemoLegalDocument = {
				kind: before?.kind ?? change.kind,
				language: before?.language ?? change.language,
				versionLabel: change.version,
				title: change.title,
				body: change.bodyMarkdown,
				publishedAt: before?.publishedAt ?? null,
				retiredAt: before?.retiredAt ?? null,
			};
			saveDocuments(
				before === undefined
					? [...documents, saved]
					: documents.map((document) =>
							document === before ? saved : document,
						),
				[saved],
			);
			return legalRowOf(store, saved);
		},

		async publishLegalDocument(_tenantId, id) {
			const draft = documentOf(id);
			if (draft.publishedAt !== null) {
				throw new SettingsWriteError("invalid");
			}
			const at = now().toISOString();
			const touched: DemoLegalDocument[] = [];
			const documents = store.legalDocuments().map((document) => {
				if (document === draft) {
					const published = { ...document, publishedAt: at };
					touched.push(published);
					return published;
				}
				if (
					document.kind === draft.kind &&
					document.language === draft.language &&
					document.publishedAt !== null &&
					document.retiredAt === null
				) {
					const retired = { ...document, retiredAt: at };
					touched.push(retired);
					return retired;
				}
				return document;
			});
			saveDocuments(documents, touched);
		},

		async retireLegalDocument(_tenantId, id) {
			const published = documentOf(id);
			if (published.publishedAt === null || published.retiredAt !== null) {
				throw new SettingsWriteError("invalid");
			}
			const retired = { ...published, retiredAt: now().toISOString() };
			saveDocuments(
				store
					.legalDocuments()
					.map((document) => (document === published ? retired : document)),
				[retired],
			);
		},

		async deleteLegalDraft(_tenantId, id) {
			const document = store
				.legalDocuments()
				.find((candidate) => legalId(candidate) === id);
			if (document === undefined) return;
			if (document.publishedAt !== null) {
				throw new SettingsWriteError("frozen");
			}
			demoWrite(() =>
				store.saveLegalDocuments(
					store.legalDocuments().filter((candidate) => candidate !== document),
				),
			);
			forgetDemoSaved(store, [id]);
		},
	};
}
