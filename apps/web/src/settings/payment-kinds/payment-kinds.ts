import { PAYMENT_KINDS, type PaymentKind } from "@fnb/core";
import type { MessageKey } from "../../i18n";
import type { Draft } from "../forms/draft";
import type { KindOverrideChange, PaymentMethodEntry } from "../source";

export type KindDraft = Draft<PaymentKind>;

export const KIND_OPTIONS: readonly PaymentKind[] = PAYMENT_KINDS;

export const KIND_LABEL_KEYS: Readonly<Record<PaymentKind, MessageKey>> = {
	cash: "report.paymentKind.cash",
	ewallet: "report.paymentKind.ewallet",
	bank_transfer: "report.paymentKind.bank_transfer",
	card: "report.paymentKind.card",
	voucher: "report.paymentKind.voucher",
	other: "report.paymentKind.other",
};

export interface MethodGroup {
	readonly posAccountId: string;
	readonly posAccountName: string;
	readonly entries: readonly PaymentMethodEntry[];
}

export function isPaymentKind(value: string): value is PaymentKind {
	return (KIND_OPTIONS as readonly string[]).includes(value);
}

export function methodKeyOf(
	entry: Pick<KindOverrideChange, "posAccountId" | "paymentMethodExternalId">,
): string {
	return `${entry.posAccountId}|${entry.paymentMethodExternalId}`;
}

export function methodEntryKeyOf(entry: PaymentMethodEntry): string {
	return methodKeyOf({
		posAccountId: entry.posAccountId,
		paymentMethodExternalId: entry.externalId,
	});
}

export function savedKindDraftOf(
	entries: readonly PaymentMethodEntry[],
): KindDraft {
	return Object.fromEntries(
		entries.map((entry) => [methodEntryKeyOf(entry), entry.overrideKind]),
	);
}

export function kindChangesOf(
	entries: readonly PaymentMethodEntry[],
	draft: KindDraft,
): KindOverrideChange[] {
	return entries.flatMap((entry) => {
		const chosen = draft[methodEntryKeyOf(entry)] ?? null;
		return chosen === entry.overrideKind
			? []
			: [
					{
						posAccountId: entry.posAccountId,
						paymentMethodExternalId: entry.externalId,
						kind: chosen,
					},
				];
	});
}

export function withKindChanges(
	entries: readonly PaymentMethodEntry[] | undefined,
	changes: readonly KindOverrideChange[],
): PaymentMethodEntry[] | undefined {
	if (entries === undefined) return entries;
	const changed = new Map(
		changes.map((change) => [methodKeyOf(change), change]),
	);
	return entries.map((entry) => {
		const change = changed.get(methodEntryKeyOf(entry));
		return change === undefined
			? entry
			: {
					...entry,
					overrideKind: change.kind,
					kind: change.kind ?? entry.posKind,
				};
	});
}

export function methodGroupsOf(
	entries: readonly PaymentMethodEntry[],
): MethodGroup[] {
	const groups = new Map<string, MethodGroup>();
	for (const entry of entries) {
		const group = groups.get(entry.posAccountId);
		groups.set(entry.posAccountId, {
			posAccountId: entry.posAccountId,
			posAccountName: entry.posAccountName,
			entries: [...(group?.entries ?? []), entry],
		});
	}
	return [...groups.values()];
}
