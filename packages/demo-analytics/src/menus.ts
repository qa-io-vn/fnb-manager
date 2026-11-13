import { MENU, type Menu, type MenuItem } from "@fnb/connector-mock";
import { roundMoney } from "@fnb/core";

export const SEASONAL_DRINK = "Nước ép dưa hấu";
export const RETIRED_DRINK = "Trà vải hoa hồng";
export const PRICE_STEP_CATEGORY = "Trà sữa";
export const PRICE_STEP_AMOUNT = 3_000;
export const SEASONAL_FIRST_MONTH = 4;
export const SEASONAL_LAST_MONTH = 9;
export const RETIRED_FROM = "2026-08-01";
export const PRICE_STEP_FROM = "2026-03-01";
export const LAUNCH_DAY_OF_MONTH = 3;

const COST_RATIO = 0.35;

interface LaunchedDrink {
	readonly code: string;
	readonly name: string;
	readonly category: string;
	readonly mediumPrice: number;
	readonly largeSurcharge: number;
}

export const LAUNCHED_DRINKS: readonly LaunchedDrink[] = [
	{
		code: "DR-NEW-001",
		name: "Trà sen vàng",
		category: "Trà trái cây",
		mediumPrice: 49_000,
		largeSurcharge: 10_000,
	},
	{
		code: "DR-NEW-002",
		name: "Cà phê dừa đá xay",
		category: "Đá xay",
		mediumPrice: 52_000,
		largeSurcharge: 8_000,
	},
];

export interface MenuVariant {
	readonly seasonalSold: boolean;
	readonly retired: boolean;
	readonly priceStep: boolean;
	readonly launched: boolean;
}

function variantKey(variant: MenuVariant): string {
	return [
		variant.seasonalSold ? "seasonal" : "",
		variant.retired ? "retired" : "",
		variant.priceStep ? "price" : "",
		variant.launched ? "launched" : "",
	].join("|");
}

function itemTypeIdOf(category: string): string {
	const type = MENU.catalog.itemTypes.find(
		(candidate) => candidate.name === category,
	);
	if (type === undefined) {
		throw new Error(`the mock menu has no item type named ${category}`);
	}
	return type.externalId;
}

function launchedItems(template: MenuItem): MenuItem[] {
	return LAUNCHED_DRINKS.flatMap((drink) =>
		(["M", "L"] as const).map((size) => {
			const listPrice =
				drink.mediumPrice + (size === "L" ? drink.largeSurcharge : 0);
			return {
				...template,
				externalId: `${drink.code}-${size}`,
				name: `${drink.name} (${size})`,
				baseName: drink.name,
				sizeLabel: size,
				itemTypeExternalId: itemTypeIdOf(drink.category),
				itemTypeName: drink.category,
				listPrice,
				takeawayPrice: listPrice,
				costPrice: roundMoney(listPrice * COST_RATIO),
				role: "drink" as const,
			};
		}),
	);
}

function steppedPrice(item: MenuItem): MenuItem {
	return {
		...item,
		listPrice: item.listPrice + PRICE_STEP_AMOUNT,
		takeawayPrice:
			item.takeawayPrice === undefined
				? undefined
				: item.takeawayPrice + PRICE_STEP_AMOUNT,
	};
}

function buildVariant(variant: MenuVariant): Menu {
	const template = MENU.drinks[0];
	if (template === undefined) {
		throw new Error("the mock menu has no drinks");
	}
	const drinks = MENU.drinks
		.filter((item) => variant.seasonalSold || item.baseName !== SEASONAL_DRINK)
		.filter((item) => !variant.retired || item.baseName !== RETIRED_DRINK)
		.map((item) =>
			variant.priceStep && item.itemTypeName === PRICE_STEP_CATEGORY
				? steppedPrice(item)
				: { ...item },
		);
	if (variant.launched) drinks.push(...launchedItems(template));
	const others = [
		...MENU.toppings,
		...MENU.freeToppings,
		...MENU.snacks,
		...MENU.modifierGroups.flatMap((group) => group.options),
	];
	const allItems = [...drinks, ...others];
	return {
		...MENU,
		drinks,
		catalog: {
			...MENU.catalog,
			items: allItems.map(({ role: _role, ...item }) => item),
		},
		itemsById: new Map(allItems.map((item) => [item.externalId, item])),
	};
}

const variants = new Map<string, Menu>();

export function demoMenu(variant: MenuVariant): Menu {
	const key = variantKey(variant);
	let menu = variants.get(key);
	if (menu === undefined) {
		menu = buildVariant(variant);
		variants.set(key, menu);
	}
	return menu;
}

export function launchDate(asOf: string): string {
	const [year, month, day] = asOf.split("-").map(Number) as [
		number,
		number,
		number,
	];
	const shift = day < LAUNCH_DAY_OF_MONTH ? -1 : 0;
	const index = year * 12 + (month - 1) + shift;
	const launchYear = Math.floor(index / 12);
	const launchMonth = index - launchYear * 12 + 1;
	return `${String(launchYear).padStart(4, "0")}-${String(launchMonth).padStart(2, "0")}-${String(LAUNCH_DAY_OF_MONTH).padStart(2, "0")}`;
}

export function menuVariantFor(
	date: string,
	asOf: string,
	withLaunches: boolean,
): MenuVariant {
	const month = Number(date.slice(5, 7));
	return {
		seasonalSold: month >= SEASONAL_FIRST_MONTH && month <= SEASONAL_LAST_MONTH,
		retired: date >= RETIRED_FROM,
		priceStep: date >= PRICE_STEP_FROM,
		launched: withLaunches && date >= launchDate(asOf),
	};
}

export function isOnMenu(
	itemExternalId: string,
	storeId: string,
	date: string,
	asOf: string,
): boolean {
	return demoMenu(
		menuVariantFor(date, asOf, storeId === "MOCK-S1"),
	).itemsById.has(itemExternalId);
}
