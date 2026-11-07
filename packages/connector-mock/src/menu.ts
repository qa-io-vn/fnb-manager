import type {
	CanonicalCatalog,
	CanonicalItem,
	CanonicalItemType,
	CanonicalModifier,
	PaymentKind,
} from "@fnb/core";
import { roundMoney } from "@fnb/core";

export interface DrinkSpec {
	name: string;
	category: string;
	mediumPrice: number;
	largeSurcharge: number | null;
}

export interface MenuItem extends CanonicalItem {
	role: "drink" | "topping" | "free_topping" | "snack" | "modifier";
}

export interface ModifierGroup {
	externalId: string;
	name: string;
	options: readonly MenuItem[];
}

export interface Menu {
	catalog: CanonicalCatalog;
	drinks: readonly MenuItem[];
	toppings: readonly MenuItem[];
	freeToppings: readonly MenuItem[];
	snacks: readonly MenuItem[];
	modifierGroups: readonly ModifierGroup[];
	itemsById: ReadonlyMap<string, MenuItem>;
}

const DRINK_CATEGORIES = [
	"Trà trái cây",
	"Trà sữa",
	"Cà phê",
	"Matcha",
	"Đá xay",
	"Nước ép",
] as const;

const DRINKS: readonly DrinkSpec[] = [
	{
		name: "Trà đào cam sả",
		category: "Trà trái cây",
		mediumPrice: 45_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Trà vải hoa hồng",
		category: "Trà trái cây",
		mediumPrice: 45_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Trà ổi hồng",
		category: "Trà trái cây",
		mediumPrice: 42_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Trà dưa lưới",
		category: "Trà trái cây",
		mediumPrice: 42_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Trà mận muối",
		category: "Trà trái cây",
		mediumPrice: 40_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Trà chanh dây",
		category: "Trà trái cây",
		mediumPrice: 40_000,
		largeSurcharge: 5_000,
	},
	{
		name: "Trà kiwi bạc hà",
		category: "Trà trái cây",
		mediumPrice: 45_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Trà sữa truyền thống",
		category: "Trà sữa",
		mediumPrice: 38_000,
		largeSurcharge: 7_000,
	},
	{
		name: "Trà sữa ô long",
		category: "Trà sữa",
		mediumPrice: 42_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Trà sữa khoai môn",
		category: "Trà sữa",
		mediumPrice: 42_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Trà sữa socola",
		category: "Trà sữa",
		mediumPrice: 40_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Trà sữa đường đen",
		category: "Trà sữa",
		mediumPrice: 45_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Hồng trà sữa",
		category: "Trà sữa",
		mediumPrice: 38_000,
		largeSurcharge: 7_000,
	},
	{
		name: "Trà sữa kem trứng",
		category: "Trà sữa",
		mediumPrice: 48_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Cà phê đen",
		category: "Cà phê",
		mediumPrice: 30_000,
		largeSurcharge: null,
	},
	{
		name: "Cà phê sữa",
		category: "Cà phê",
		mediumPrice: 35_000,
		largeSurcharge: null,
	},
	{
		name: "Bạc xỉu",
		category: "Cà phê",
		mediumPrice: 38_000,
		largeSurcharge: 7_000,
	},
	{
		name: "Cà phê muối",
		category: "Cà phê",
		mediumPrice: 42_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Cà phê cốt dừa",
		category: "Cà phê",
		mediumPrice: 45_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Cà phê trứng",
		category: "Cà phê",
		mediumPrice: 45_000,
		largeSurcharge: null,
	},
	{
		name: "Cold brew cam",
		category: "Cà phê",
		mediumPrice: 48_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Matcha Latte",
		category: "Matcha",
		mediumPrice: 50_000,
		largeSurcharge: null,
	},
	{
		name: "Matcha sữa dừa",
		category: "Matcha",
		mediumPrice: 52_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Matcha dâu",
		category: "Matcha",
		mediumPrice: 55_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Matcha đậu đỏ",
		category: "Matcha",
		mediumPrice: 52_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Matcha yến mạch",
		category: "Matcha",
		mediumPrice: 55_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Matcha đá xay",
		category: "Matcha",
		mediumPrice: 55_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Socola đá xay",
		category: "Đá xay",
		mediumPrice: 50_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Bánh quy đá xay",
		category: "Đá xay",
		mediumPrice: 52_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Caramel đá xay",
		category: "Đá xay",
		mediumPrice: 50_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Dâu đá xay",
		category: "Đá xay",
		mediumPrice: 50_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Việt quất đá xay",
		category: "Đá xay",
		mediumPrice: 55_000,
		largeSurcharge: 10_000,
	},
	{
		name: "Xoài đá xay",
		category: "Đá xay",
		mediumPrice: 48_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Nước ép cam",
		category: "Nước ép",
		mediumPrice: 40_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Nước ép dưa hấu",
		category: "Nước ép",
		mediumPrice: 38_000,
		largeSurcharge: 7_000,
	},
	{
		name: "Nước ép ổi",
		category: "Nước ép",
		mediumPrice: 38_000,
		largeSurcharge: 7_000,
	},
	{
		name: "Nước ép táo",
		category: "Nước ép",
		mediumPrice: 42_000,
		largeSurcharge: 8_000,
	},
	{
		name: "Nước ép cà rốt",
		category: "Nước ép",
		mediumPrice: 38_000,
		largeSurcharge: 5_000,
	},
	{
		name: "Nước ép dứa",
		category: "Nước ép",
		mediumPrice: 38_000,
		largeSurcharge: 7_000,
	},
	{
		name: "Nước ép cần tây",
		category: "Nước ép",
		mediumPrice: 45_000,
		largeSurcharge: null,
	},
];

const TOPPINGS: readonly [string, number][] = [
	["Trân châu đen", 8_000],
	["Trân châu trắng", 8_000],
	["Pudding trứng", 10_000],
	["Thạch dừa", 7_000],
	["Kem cheese", 12_000],
	["Hạt sen", 10_000],
];

const FREE_TOPPINGS: readonly string[] = [
	"Thạch tặng kèm",
	"Trân châu tặng kèm",
];

const SNACKS: readonly [string, number][] = [
	["Hạt bí rang", 15_000],
	["Bánh quy bơ", 20_000],
	["Khoai tây chiên", 30_000],
	["Bánh su kem", 25_000],
	["Bánh tart trứng", 25_000],
];

const MODIFIER_GROUPS: readonly [string, readonly string[]][] = [
	["Đường", ["0% Đường", "30% Đường", "50% Đường", "70% Đường", "100% Đường"]],
	["Đá", ["0% Đá", "30% Đá", "50% Đá", "70% Đá"]],
];

const TOPPING_CATEGORY = "Topping";
const FREE_TOPPING_CATEGORY = "Topping tặng";
const SNACK_CATEGORY = "Đồ ăn kèm";
const MODIFIER_CATEGORY = "Tuỳ chọn";
const DRINK_CLASS = "Đồ uống";
const FOOD_CLASS = "Đồ ăn";
const COST_RATIO = 0.35;

function pad(value: number): string {
	return String(value).padStart(3, "0");
}

function typeId(index: number): string {
	return `TYPE-${pad(index + 1)}`;
}

function buildItemTypes(): CanonicalItemType[] {
	const names = [
		...DRINK_CATEGORIES,
		TOPPING_CATEGORY,
		FREE_TOPPING_CATEGORY,
		SNACK_CATEGORY,
		MODIFIER_CATEGORY,
	];
	return names.map((name, index) => ({ externalId: typeId(index), name }));
}

function itemTypeIdFor(
	types: readonly CanonicalItemType[],
	name: string,
): string {
	const type = types.find((candidate) => candidate.name === name);
	if (!type) {
		throw new Error(`menu has no item type named ${name}`);
	}
	return type.externalId;
}

function sizedItem(
	externalId: string,
	spec: DrinkSpec,
	sizeLabel: "M" | "L" | null,
	types: readonly CanonicalItemType[],
): MenuItem {
	const surcharge = sizeLabel === "L" ? (spec.largeSurcharge ?? 0) : 0;
	const listPrice = spec.mediumPrice + surcharge;
	return {
		externalId,
		name: sizeLabel ? `${spec.name} (${sizeLabel})` : spec.name,
		baseName: spec.name,
		sizeLabel: sizeLabel ?? undefined,
		itemTypeExternalId: itemTypeIdFor(types, spec.category),
		itemTypeName: spec.category,
		itemClassName: DRINK_CLASS,
		listPrice,
		takeawayPrice: listPrice,
		costPrice: roundMoney(listPrice * COST_RATIO),
		isModifier: false,
		active: true,
		role: "drink",
	};
}

function simpleItem(
	externalId: string,
	name: string,
	category: string,
	listPrice: number,
	role: MenuItem["role"],
	types: readonly CanonicalItemType[],
): MenuItem {
	const isModifier = role === "modifier";
	return {
		externalId,
		name,
		baseName: name,
		sizeLabel: undefined,
		itemTypeExternalId: itemTypeIdFor(types, category),
		itemTypeName: category,
		itemClassName: role === "snack" ? FOOD_CLASS : DRINK_CLASS,
		listPrice,
		takeawayPrice: listPrice,
		costPrice: isModifier ? undefined : roundMoney(listPrice * COST_RATIO),
		isModifier,
		active: true,
		role,
	};
}

export function buildMenu(): Menu {
	const itemTypes = buildItemTypes();
	const drinks: MenuItem[] = [];
	DRINKS.forEach((spec, index) => {
		const code = `DR-${pad(index + 1)}`;
		if (spec.largeSurcharge === null) {
			drinks.push(sizedItem(code, spec, null, itemTypes));
			return;
		}
		drinks.push(sizedItem(`${code}-M`, spec, "M", itemTypes));
		drinks.push(sizedItem(`${code}-L`, spec, "L", itemTypes));
	});
	const toppings = TOPPINGS.map(([name, price], index) =>
		simpleItem(
			`TP-${pad(index + 1)}`,
			name,
			TOPPING_CATEGORY,
			price,
			"topping",
			itemTypes,
		),
	);
	const freeToppings = FREE_TOPPINGS.map((name, index) =>
		simpleItem(
			`FT-${pad(index + 1)}`,
			name,
			FREE_TOPPING_CATEGORY,
			0,
			"free_topping",
			itemTypes,
		),
	);
	const snacks = SNACKS.map(([name, price], index) =>
		simpleItem(
			`SN-${pad(index + 1)}`,
			name,
			SNACK_CATEGORY,
			price,
			"snack",
			itemTypes,
		),
	);
	let optionCounter = 0;
	const modifierGroups: ModifierGroup[] = MODIFIER_GROUPS.map(
		([groupName, names], groupIndex) => ({
			externalId: `CUST-${pad(groupIndex + 1)}`,
			name: groupName,
			options: names.map((name) => {
				optionCounter += 1;
				return simpleItem(
					`OPT-${pad(optionCounter)}`,
					name,
					MODIFIER_CATEGORY,
					0,
					"modifier",
					itemTypes,
				);
			}),
		}),
	);
	const modifierItems = modifierGroups.flatMap((group) => group.options);
	const allItems = [
		...drinks,
		...toppings,
		...freeToppings,
		...snacks,
		...modifierItems,
	];
	const modifiers: CanonicalModifier[] = modifierGroups.map((group) => ({
		externalId: group.externalId,
		name: group.name,
		groupName: group.name,
		appliesToItemExternalIds: drinks.map((drink) => drink.externalId),
		raw: { options: group.options.map((option) => option.externalId) },
	}));
	const paymentMethods: {
		externalId: string;
		name: string;
		kind: PaymentKind;
	}[] = [
		{ externalId: "PM-EWALLET", name: "Ví điện tử QR", kind: "ewallet" },
		{ externalId: "PM-CASH", name: "Tiền mặt", kind: "cash" },
		{ externalId: "PM-BANK", name: "Chuyển khoản", kind: "bank_transfer" },
	];
	const catalog: CanonicalCatalog = {
		items: allItems.map(({ role: _role, ...item }) => item),
		itemTypes,
		itemClasses: [
			{ externalId: "CLASS-01", name: DRINK_CLASS },
			{ externalId: "CLASS-02", name: FOOD_CLASS },
		],
		modifiers,
		paymentMethods,
		sources: [
			{ externalId: "SRC-01", name: "TẠI CHỖ", isDelivery: false },
			{ externalId: "SRC-02", name: "MANG VỀ", isDelivery: false },
			{ externalId: "SRC-03", name: "GIAO HÀNG", isDelivery: true },
		],
		promotions: [
			{ externalId: "PROMO-01", name: "Voucher 10k", raw: null },
			{ externalId: "PROMO-02", name: "Voucher 15k", raw: null },
			{ externalId: "PROMO-03", name: "Voucher 20k", raw: null },
			{ externalId: "PROMO-04", name: "Giảm giá món", raw: null },
			{ externalId: "PROMO-05", name: "Giảm giá hoá đơn", raw: null },
		],
		packages: [],
	};
	return {
		catalog,
		drinks,
		toppings,
		freeToppings,
		snacks,
		modifierGroups,
		itemsById: new Map(allItems.map((item) => [item.externalId, item])),
	};
}

export const MENU: Menu = buildMenu();
