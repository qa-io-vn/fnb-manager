import { MENU } from "@fnb/connector-mock";
import type { PaymentKind } from "@fnb/core";
import { DEMO_POS_ACCOUNT_ID } from "../calendar.js";

export interface DemoItemCatalogue {
	readonly itemTypes: ReadonlySet<string>;
	readonly modifiers: ReadonlySet<string>;
}

export interface DemoPaymentMethod {
	readonly externalId: string;
	readonly name: string;
	readonly kind: PaymentKind;
}

const DEMO_ITEM_CATALOGUE: DemoItemCatalogue = {
	itemTypes: new Set(MENU.catalog.itemTypes.map((type) => type.externalId)),
	modifiers: new Set(
		MENU.catalog.items
			.filter((item) => item.isModifier)
			.map((item) => item.externalId),
	),
};

const DEMO_PAYMENT_CATALOGUE: readonly DemoPaymentMethod[] =
	MENU.catalog.paymentMethods.map((method) => ({
		externalId: method.externalId,
		name: method.name,
		kind: method.kind,
	}));

export function demoItemCatalogue(
	posAccountId: string,
): DemoItemCatalogue | null {
	return posAccountId === DEMO_POS_ACCOUNT_ID ? DEMO_ITEM_CATALOGUE : null;
}

export function demoPaymentCatalogue(
	_posAccountId: string,
): readonly DemoPaymentMethod[] {
	return DEMO_PAYMENT_CATALOGUE;
}
