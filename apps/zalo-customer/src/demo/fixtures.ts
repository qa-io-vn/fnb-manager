export const DEMO_TENANT_ID = "00000000-0000-4000-8000-0000000000c1";
export const DEMO_CUSTOMER_ID = "00000000-0000-4000-8000-0000000000c2";
export const DEMO_MEMBERSHIP_ID = "00000000-0000-4000-8000-0000000000c3";
export const DEMO_DISPLAY_NAME = "Khách thử";
export const DEMO_PHONE_MASKED = "•••• ••• 789";
export const DEMO_PHONE_TOKEN = "mock-phone-token";
export const DEMO_OA_ID = "mock-oa-1";
export const DEMO_POLICY_VERSION = "privacy-demo-1";
export const DEMO_TERMS_VERSION = "terms-demo-1";
export const DEMO_WELCOME_STAMPS = 1;
export const DEMO_STAMPS_PER_CARD = 10;
export const DEMO_PUBLISHED_AT = "2026-11-01T00:00:00+07:00";

const HOURS_EVERY_DAY = {
	mon: [["07:00", "22:00"]],
	tue: [["07:00", "22:00"]],
	wed: [["07:00", "22:00"]],
	thu: [["07:00", "22:00"]],
	fri: [["07:00", "22:30"]],
	sat: [["07:30", "22:30"]],
	sun: [["07:30", "21:30"]],
};

const HOURS_SPLIT = {
	mon: [
		["06:30", "11:00"],
		["15:00", "21:00"],
	],
	tue: [
		["06:30", "11:00"],
		["15:00", "21:00"],
	],
	wed: [
		["06:30", "11:00"],
		["15:00", "21:00"],
	],
	thu: [
		["06:30", "11:00"],
		["15:00", "21:00"],
	],
	fri: [
		["06:30", "11:00"],
		["15:00", "21:00"],
	],
	sat: [["07:00", "21:00"]],
	sun: [],
};

export const DEMO_STORES = [
	{
		code: "mau-1",
		name: "Cửa hàng Mẫu 1",
		address: "12 Đường Số 1, Phường Mẫu, Thành phố Mẫu",
		opening_hours: HOURS_EVERY_DAY,
	},
	{
		code: "mau-2",
		name: "Cửa hàng Mẫu 2",
		address: "34 Đường Số 2, Phường Mẫu, Thành phố Mẫu",
		opening_hours: HOURS_SPLIT,
	},
] as const;

export const DEMO_MENU = [
	{
		id: "menu-1",
		name: "Cà phê sữa đá",
		description: "Cà phê phin pha với sữa đặc, uống cùng đá.",
		category: "Cà phê",
		store_codes: null,
	},
	{
		id: "menu-2",
		name: "Bạc xỉu",
		description: "Nhiều sữa, ít cà phê.",
		category: "Cà phê",
		store_codes: null,
	},
	{
		id: "menu-3",
		name: "Trà đào cam sả",
		description: "Trà đen, đào miếng, cam và sả tươi.",
		category: "Trà",
		store_codes: null,
	},
	{
		id: "menu-4",
		name: "Bánh mì que",
		description: "Nướng giòn mỗi sáng.",
		category: "Bánh",
		store_codes: ["mau-1"],
	},
] as const;

export const DEMO_PROGRAMME = {
	name: "Thành viên Quán Mẫu Một",
	starts_on: "2026-11-01",
	ends_on: null,
	stamps_per_card: DEMO_STAMPS_PER_CARD,
	welcome_stamps: DEMO_WELCOME_STAMPS,
	stamp_validity_months: 6,
	points_enabled: true,
	points_expiry_months: 12,
	receipt_claims_per_day: 3,
	receipt_claim_window_hours: 72,
	summary: null,
	stamp_rule: null,
	points_rule: null,
	reward_summary: "Đủ 10 dấu: tặng 1 ly bất kỳ.",
	retention_months: 24,
	tiers: [
		{ code: "member", name: "Thành viên", min_points: 0 },
		{ code: "silver", name: "Bạc", min_points: 500 },
		{ code: "gold", name: "Vàng", min_points: 1500 },
	],
} as const;

const BODY_VI = [
	"## Văn bản giữ chỗ",
	"",
	"Đây là văn bản giữ chỗ của bản thử, không phải văn bản pháp lý. Văn bản thật do cửa hàng soạn và công bố.",
	"",
	"- Dữ liệu thu thập: số điện thoại Zalo, tên hiển thị, mã người dùng Zalo và lịch sử mua hàng.",
	"- Mục đích: cộng dấu và điểm, đổi quà.",
	"- Bạn có thể dừng nhận tin hoặc rời chương trình bất cứ lúc nào trong mục Tài khoản.",
].join("\n");

const BODY_EN = [
	"## Placeholder",
	"",
	"This is a placeholder of the demo, not a legal text. The shop writes and publishes the real one.",
	"",
	"- Data collected: the Zalo phone number, display name, Zalo user id and purchase history.",
	"- Purpose: stamps and points, rewards.",
	"- You can stop messages or leave the programme at any time under Account.",
].join("\n");

export const DEMO_LEGAL = {
	entity_name: "Hộ kinh doanh Quán Mẫu Một",
	policy_version: DEMO_POLICY_VERSION,
	documents: [
		{
			kind: "privacy_notice",
			language: "vi",
			version: DEMO_POLICY_VERSION,
			title: "Chính sách bảo mật",
			body_markdown: BODY_VI,
			published_at: DEMO_PUBLISHED_AT,
		},
		{
			kind: "privacy_notice",
			language: "en",
			version: DEMO_POLICY_VERSION,
			title: "Privacy policy",
			body_markdown: BODY_EN,
			published_at: DEMO_PUBLISHED_AT,
		},
		{
			kind: "mini_app_terms",
			language: "vi",
			version: DEMO_TERMS_VERSION,
			title: "Điều khoản sử dụng",
			body_markdown: BODY_VI,
			published_at: DEMO_PUBLISHED_AT,
		},
		{
			kind: "mini_app_terms",
			language: "en",
			version: DEMO_TERMS_VERSION,
			title: "Terms of use",
			body_markdown: BODY_EN,
			published_at: DEMO_PUBLISHED_AT,
		},
	],
} as const;

export interface DemoInvoice {
	readonly store: string;
	readonly receiptNo: string;
	readonly amount: number;
	readonly daysAgo: number;
	readonly points: number;
}

export const DEMO_SYNCED_INVOICES: readonly DemoInvoice[] = [
	{ store: "mau-1", receiptNo: "1001", amount: 85_000, daysAgo: 0, points: 85 },
	{ store: "mau-2", receiptNo: "2002", amount: 42_000, daysAgo: 1, points: 42 },
];

export interface DemoReward {
	readonly coupon_id: string;
	readonly reward_key: string;
	readonly name: string;
	readonly description: string | null;
	readonly reward_kind:
		| "free_item"
		| "percent_off"
		| "amount_off"
		| "free_upgrade";
	readonly reward_percent: number | null;
	readonly reward_item_names: readonly string[] | null;
	readonly cost_stamps: number;
	readonly cost_points: number;
	readonly store_codes: readonly string[] | null;
	readonly valid_from: string | null;
	readonly valid_until: string | null;
	readonly hold_hours: number;
	readonly per_member_limit: number | null;
}

export const DEMO_REWARDS: readonly DemoReward[] = [
	{
		coupon_id: "00000000-0000-4000-8000-000000000a01",
		reward_key: "free-coffee",
		name: "Tặng 1 ly cà phê sữa",
		description: "Một ly cà phê sữa đá cỡ vừa, dùng tại quầy.",
		reward_kind: "free_item",
		reward_percent: null,
		reward_item_names: ["Cà phê sữa đá"],
		cost_stamps: 3,
		cost_points: 0,
		store_codes: null,
		valid_from: "2026-11-01",
		valid_until: null,
		hold_hours: 24,
		per_member_limit: null,
	},
	{
		coupon_id: "00000000-0000-4000-8000-000000000a02",
		reward_key: "cookie",
		name: "Tặng bánh quy bơ",
		description: null,
		reward_kind: "free_item",
		reward_percent: null,
		reward_item_names: ["Bánh quy bơ"],
		cost_stamps: 0,
		cost_points: 50,
		store_codes: null,
		valid_from: null,
		valid_until: null,
		hold_hours: 24,
		per_member_limit: 1,
	},
	{
		coupon_id: "00000000-0000-4000-8000-000000000a03",
		reward_key: "ten-percent",
		name: "Giảm 10% hóa đơn",
		description: "Áp dụng cho hóa đơn tại Cửa hàng Mẫu 1.",
		reward_kind: "percent_off",
		reward_percent: 10,
		reward_item_names: null,
		cost_stamps: 0,
		cost_points: 150,
		store_codes: ["mau-1"],
		valid_from: null,
		valid_until: null,
		hold_hours: 24,
		per_member_limit: null,
	},
	{
		coupon_id: "00000000-0000-4000-8000-000000000a04",
		reward_key: "size-up",
		name: "Nâng cỡ ly miễn phí",
		description: null,
		reward_kind: "free_upgrade",
		reward_percent: null,
		reward_item_names: null,
		cost_stamps: 5,
		cost_points: 0,
		store_codes: null,
		valid_from: null,
		valid_until: null,
		hold_hours: 24,
		per_member_limit: null,
	},
];

export const DEMO_REDEEM_CODES: readonly string[] = [
	"K7M2Q9TX",
	"P4R8W3HN",
	"T6Y2C9VB",
	"H3N7X5QM",
];
