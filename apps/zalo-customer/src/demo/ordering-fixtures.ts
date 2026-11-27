// The synthetic native menu of the demo world: store mau-1 takes table orders paid at the counter. Names, prices and
// tokens are invented; ids follow the synthetic pattern (eight identical characters first).

export const DEMO_ORDERING_STORE = "mau-1";

export const DEMO_CATEGORIES = {
	coffee: "cccccccc-0000-4000-8000-000000000001",
	tea: "cccccccc-0000-4000-8000-000000000002",
	bakery: "cccccccc-0000-4000-8000-000000000003",
} as const;

export const DEMO_GROUPS = {
	ice: "aaaaaaaa-0000-4000-8000-000000000001",
	sweet: "aaaaaaaa-0000-4000-8000-000000000002",
	extra: "aaaaaaaa-0000-4000-8000-000000000003",
} as const;

export const DEMO_OPTIONS = {
	iceNormal: "bbbbbbbb-0000-4000-8000-000000000001",
	iceLess: "bbbbbbbb-0000-4000-8000-000000000002",
	iceNone: "bbbbbbbb-0000-4000-8000-000000000003",
	sweetNormal: "bbbbbbbb-0000-4000-8000-000000000004",
	sweetLess: "bbbbbbbb-0000-4000-8000-000000000005",
	sweetNone: "bbbbbbbb-0000-4000-8000-000000000006",
	shot: "bbbbbbbb-0000-4000-8000-000000000007",
	saltCream: "bbbbbbbb-0000-4000-8000-000000000008",
} as const;

export const DEMO_ITEMS = {
	milkCoffee: "dddddddd-0000-4000-8000-000000000001",
	blackCoffee: "dddddddd-0000-4000-8000-000000000002",
	bacXiu: "dddddddd-0000-4000-8000-000000000003",
	peachTea: "dddddddd-0000-4000-8000-000000000004",
	lotusTea: "dddddddd-0000-4000-8000-000000000005",
	bananaCake: "dddddddd-0000-4000-8000-000000000006",
} as const;

export const DEMO_SIZES = {
	milkCoffeeM: "eeeeeeee-0000-4000-8000-000000000001",
	milkCoffeeL: "eeeeeeee-0000-4000-8000-000000000002",
	blackCoffee: "eeeeeeee-0000-4000-8000-000000000003",
	bacXiuM: "eeeeeeee-0000-4000-8000-000000000004",
	bacXiuL: "eeeeeeee-0000-4000-8000-000000000005",
	peachTea: "eeeeeeee-0000-4000-8000-000000000006",
	lotusTea: "eeeeeeee-0000-4000-8000-000000000007",
	bananaCake: "eeeeeeee-0000-4000-8000-000000000008",
} as const;

export interface DemoOption {
	readonly id: string;
	readonly name: string;
	readonly price_delta: number;
	readonly is_default: boolean;
}

export interface DemoGroup {
	readonly id: string;
	readonly name: string;
	readonly min_select: number;
	readonly max_select: number;
	readonly options: readonly DemoOption[];
}

export interface DemoSize {
	readonly id: string;
	readonly label: string | null;
	price: number;
	readonly is_default: boolean;
}

export interface DemoItem {
	readonly id: string;
	readonly category: string;
	readonly name: string;
	readonly description: string | null;
	readonly labels: readonly string[];
	readonly counts_for_stamps: boolean;
	readonly sizes: readonly DemoSize[];
	readonly groups: readonly string[];
}

export const DEMO_OPTION_GROUPS: readonly DemoGroup[] = [
	{
		id: DEMO_GROUPS.ice,
		name: "Đá",
		min_select: 1,
		max_select: 1,
		options: [
			{
				id: DEMO_OPTIONS.iceNormal,
				name: "Bình thường",
				price_delta: 0,
				is_default: true,
			},
			{
				id: DEMO_OPTIONS.iceLess,
				name: "Ít đá",
				price_delta: 0,
				is_default: false,
			},
			{
				id: DEMO_OPTIONS.iceNone,
				name: "Không đá",
				price_delta: 0,
				is_default: false,
			},
		],
	},
	{
		id: DEMO_GROUPS.sweet,
		name: "Độ ngọt",
		min_select: 1,
		max_select: 1,
		options: [
			{
				id: DEMO_OPTIONS.sweetNormal,
				name: "Bình thường",
				price_delta: 0,
				is_default: true,
			},
			{
				id: DEMO_OPTIONS.sweetLess,
				name: "Ít ngọt",
				price_delta: 0,
				is_default: false,
			},
			{
				id: DEMO_OPTIONS.sweetNone,
				name: "Không đường",
				price_delta: 0,
				is_default: false,
			},
		],
	},
	{
		id: DEMO_GROUPS.extra,
		name: "Thêm",
		min_select: 0,
		max_select: 2,
		options: [
			{
				id: DEMO_OPTIONS.shot,
				name: "Thêm một shot",
				price_delta: 10000,
				is_default: false,
			},
			{
				id: DEMO_OPTIONS.saltCream,
				name: "Kem muối",
				price_delta: 8000,
				is_default: false,
			},
		],
	},
];

export function demoMenuItems(): DemoItem[] {
	return [
		{
			id: DEMO_ITEMS.milkCoffee,
			category: DEMO_CATEGORIES.coffee,
			name: "Cà phê sữa",
			description: "Cà phê phin, sữa đặc vừa đủ ngọt.",
			labels: ["best_seller"],
			counts_for_stamps: true,
			sizes: [
				{
					id: DEMO_SIZES.milkCoffeeM,
					label: "Vừa",
					price: 35000,
					is_default: true,
				},
				{
					id: DEMO_SIZES.milkCoffeeL,
					label: "Lớn",
					price: 45000,
					is_default: false,
				},
			],
			groups: [DEMO_GROUPS.ice, DEMO_GROUPS.sweet],
		},
		{
			id: DEMO_ITEMS.blackCoffee,
			category: DEMO_CATEGORIES.coffee,
			name: "Cà phê đen",
			description: "Đậm, đắng nhẹ.",
			labels: [],
			counts_for_stamps: true,
			sizes: [
				{
					id: DEMO_SIZES.blackCoffee,
					label: null,
					price: 29000,
					is_default: true,
				},
			],
			groups: [DEMO_GROUPS.ice, DEMO_GROUPS.sweet],
		},
		{
			id: DEMO_ITEMS.bacXiu,
			category: DEMO_CATEGORIES.coffee,
			name: "Bạc xỉu",
			description: "Nhiều sữa, ít cà phê.",
			labels: [],
			counts_for_stamps: true,
			sizes: [
				{
					id: DEMO_SIZES.bacXiuM,
					label: "Vừa",
					price: 39000,
					is_default: true,
				},
				{
					id: DEMO_SIZES.bacXiuL,
					label: "Lớn",
					price: 49000,
					is_default: false,
				},
			],
			groups: [DEMO_GROUPS.ice, DEMO_GROUPS.extra],
		},
		{
			id: DEMO_ITEMS.peachTea,
			category: DEMO_CATEGORIES.tea,
			name: "Trà đào",
			description: "Trà đen, đào miếng.",
			labels: ["new"],
			counts_for_stamps: true,
			sizes: [
				{
					id: DEMO_SIZES.peachTea,
					label: null,
					price: 45000,
					is_default: true,
				},
			],
			groups: [DEMO_GROUPS.ice, DEMO_GROUPS.sweet],
		},
		{
			id: DEMO_ITEMS.lotusTea,
			category: DEMO_CATEGORIES.tea,
			name: "Trà sen",
			description: null,
			labels: [],
			counts_for_stamps: true,
			sizes: [
				{
					id: DEMO_SIZES.lotusTea,
					label: null,
					price: 49000,
					is_default: true,
				},
			],
			groups: [],
		},
		{
			id: DEMO_ITEMS.bananaCake,
			category: DEMO_CATEGORIES.bakery,
			name: "Bánh chuối",
			description: "Nướng mỗi sáng.",
			labels: [],
			counts_for_stamps: false,
			sizes: [
				{
					id: DEMO_SIZES.bananaCake,
					label: null,
					price: 25000,
					is_default: true,
				},
			],
			groups: [],
		},
	];
}

export const DEMO_CATEGORY_NAMES: Readonly<Record<string, string>> = {
	[DEMO_CATEGORIES.coffee]: "Cà phê",
	[DEMO_CATEGORIES.tea]: "Trà",
	[DEMO_CATEGORIES.bakery]: "Bánh",
};

/** The tables of mau-1 and the token each card carries now; the old card of table 12 was rotated. */
export const DEMO_TABLES = [
	{ token: "demo-table-12", label: "Bàn 12", area: "Tầng 1" },
	{ token: "demo-table-3", label: "Bàn 3", area: "Sân" },
] as const;

export const DEMO_ROTATED_TABLE_TOKEN = "demo-table-12-old";

/** An order of another customer: reading it answers exactly as an unknown id (IDOR). */
export const DEMO_FOREIGN_ORDER_ID = "ffffffff-0000-4000-8000-000000000001";

/**
 * The synthetic bank account of the demo store's VietQR (a stand-in of the server's provider settings): no real bank,
 * BIN or account.
 */
export const DEMO_BANK = {
	bin: "970400",
	name: "Ngân hàng Mẫu",
	accountNumber: "0123456789",
	accountName: "CUA HANG MAU",
} as const;

/** How long an online attempt holds the order before it is cancelled (payment_timeout). */
export const DEMO_PAYMENT_WINDOW_MS = 15 * 60_000;
