import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CONSULTATION_TEXTS,
	CUSTOMER_MESSAGE_KINDS,
	consultationText,
	KIND_TEMPLATE_PURPOSES,
	NAME_FALLBACK,
	placeholdersOf,
	TEMPLATE_PARAMETER_NAMES,
	TemplateParameterError,
	templateData,
	ZBS_TEMPLATE_DRAFTS,
	ZBS_TEMPLATE_PURPOSES,
} from "../../../src/index.js";

const DOC = readFileSync(
	new URL("../../../../../docs/loyalty/zbs-templates.md", import.meta.url),
	"utf8",
).replace(/\r\n/g, "\n");

interface DocDraft {
	readonly body: string;
	readonly parameters: readonly {
		name: string;
		type: string;
		maxLength: number;
		sample: string;
	}[];
	readonly header: string;
}

function docDrafts(): Map<string, DocDraft> {
	const drafts = new Map<string, DocDraft>();
	const sections = DOC.split(/\n### `/).slice(1);
	for (const section of sections) {
		const purpose = section.slice(0, section.indexOf("`"));
		const body = /```text\n([\s\S]*?)\n```/.exec(section)?.[1] ?? "";
		const parameters = [
			...section.matchAll(/^\| `([a-z_]+)` \| ([a-z]+) \| (\d+) \| (.+) \|$/gm),
		].map((match) => ({
			name: match[1] ?? "",
			type: match[2] ?? "",
			maxLength: Number(match[3]),
			sample: match[4] ?? "",
		}));
		drafts.set(purpose, {
			body,
			parameters,
			header: section.split("\n\n")[1] ?? "",
		});
	}
	return drafts;
}

const VIETNAMESE_MARKS =
	/[ạảãàáâậầấẩẫăắằặẳẵóòọõỏôộổỗồốơờớợởỡéèẻẹẽêếềệểễúùụủũưựữửừứíìịỉĩýỳỷỵỹđ]/i;
const LINK = /(https?:\/\/|www\.|\.(com|vn|net|me)\b|zalo\.me)/i;
const PHONE = /(\+?84|0)\d{8,10}\b|\d{3}[ .-]\d{3}[ .-]\d{3,4}/;

describe("the ZBS template drafts", () => {
	const drafts = docDrafts();

	it("documents exactly the registered purposes", () => {
		expect([...drafts.keys()].sort()).toEqual(
			[...ZBS_TEMPLATE_PURPOSES].sort(),
		);
	});

	it.each(ZBS_TEMPLATE_PURPOSES)(
		"keeps the %s draft equal in the doc and the registry",
		(purpose) => {
			const doc = drafts.get(purpose);
			const draft = ZBS_TEMPLATE_DRAFTS[purpose];
			expect(doc?.body).toBe(draft.body);
			expect(
				doc?.parameters.map(({ name, type, maxLength, sample }) => ({
					name,
					type,
					maxLength,
					sample,
				})),
			).toEqual(
				draft.parameters.map(({ name, type, maxLength, sample }) => ({
					name,
					type,
					maxLength,
					sample,
				})),
			);
			expect(doc?.header).toContain(`Tag: ${draft.tag}`);
			expect(doc?.header).toContain(`«${draft.button}»`);
		},
	);

	it.each(ZBS_TEMPLATE_PURPOSES)(
		"names in the %s body only registered parameters, each once in its list",
		(purpose) => {
			const draft = ZBS_TEMPLATE_DRAFTS[purpose];
			const used = placeholdersOf(draft.body);
			const listed = draft.parameters.map((parameter) => parameter.name);
			expect(new Set(used)).toEqual(new Set(listed));
			expect(new Set(listed).size).toBe(listed.length);
			for (const name of listed) {
				expect(TEMPLATE_PARAMETER_NAMES).toContain(name);
			}
		},
	);

	it.each(ZBS_TEMPLATE_PURPOSES)(
		"passes the content checklist for %s",
		(purpose) => {
			const draft = ZBS_TEMPLATE_DRAFTS[purpose];
			for (const text of [draft.title, draft.body, draft.button]) {
				expect(text).toMatch(VIETNAMESE_MARKS);
				expect(text).not.toMatch(LINK);
				expect(text).not.toMatch(PHONE);
				expect(text).not.toMatch(/hoá đơn|huỷ|tuỳ/);
			}
			for (const parameter of draft.parameters) {
				expect([...parameter.sample].length).toBeLessThanOrEqual(
					parameter.maxLength,
				);
			}
		},
	);

	it("puts a code only in the Voucher layout", () => {
		for (const draft of Object.values(ZBS_TEMPLATE_DRAFTS)) {
			const hasCode = draft.parameters.some(
				(parameter) => parameter.name === "voucher_code",
			);
			expect(hasCode).toBe(draft.layout === "voucher");
		}
	});

	it("leaves birthday and win-back to the reviewers and keeps them out of the promotion tag until accepted", () => {
		expect(ZBS_TEMPLATE_DRAFTS.birthday.reviewerDecision).toBe(true);
		expect(ZBS_TEMPLATE_DRAFTS.win_back.reviewerDecision).toBe(true);
		for (const purpose of [
			"points_confirmation",
			"coupon_issued",
			"voucher",
			"expiry_reminder",
		] as const) {
			expect(ZBS_TEMPLATE_DRAFTS[purpose].reviewerDecision).toBe(false);
			expect(ZBS_TEMPLATE_DRAFTS[purpose].tag).not.toBe("promotion");
		}
	});

	it("maps every customer kind to registered purposes, as the SQL does", () => {
		expect(Object.keys(KIND_TEMPLATE_PURPOSES).sort()).toEqual(
			[...CUSTOMER_MESSAGE_KINDS].sort(),
		);
		expect(KIND_TEMPLATE_PURPOSES.coupon_issued).toEqual([
			"voucher",
			"coupon_issued",
		]);
		const migration = readFileSync(
			new URL(
				"../../../../../supabase/migrations/20261119930000_customer_message_routing.sql",
				import.meta.url,
			),
			"utf8",
		);
		for (const [kind, purposes] of Object.entries(KIND_TEMPLATE_PURPOSES)) {
			expect(migration).toContain(
				`when '${kind}' then array[${purposes.map((p) => `'${p}'`).join(", ")}]`,
			);
		}
	});

	it("keeps the consultation texts to the same parameters and checklist", () => {
		for (const text of Object.values(CONSULTATION_TEXTS)) {
			expect(text).toMatch(VIETNAMESE_MARKS);
			expect(text).not.toMatch(LINK);
			expect(text).not.toMatch(PHONE);
			for (const name of placeholdersOf(text)) {
				expect(TEMPLATE_PARAMETER_NAMES).toContain(name);
			}
		}
	});
});

describe("template parameter mapping", () => {
	it("maps the resolved parameters to the template data of a purpose", () => {
		expect(
			templateData("points_confirmation", {
				customer_name: "Synthetic A",
				bill_no: "001234",
				store_name: "Cửa hàng 1",
				points: 1200,
				stamps: 1,
				voucher_code: "NOT-USED",
			}),
		).toEqual({
			customer_name: "Synthetic A",
			bill_no: "001234",
			store_name: "Cửa hàng 1",
			points: "1.200",
			stamps: "1",
		});
	});

	it("greets a customer without a name politely and clips a long name", () => {
		expect(templateData("birthday", {})).toEqual({
			customer_name: NAME_FALLBACK,
		});
		expect(templateData("birthday", { customer_name: "   " })).toEqual({
			customer_name: NAME_FALLBACK,
		});
		const clipped =
			templateData("birthday", { customer_name: "A".repeat(40) })
				.customer_name ?? "";
		expect([...clipped]).toHaveLength(30);
		expect(clipped.endsWith("…")).toBe(true);
	});

	it("counts a missing number as zero and never a negative", () => {
		expect(
			templateData("expiry_reminder", { expires_at: "20/11/2026", points: -3 }),
		).toMatchObject({ points: "0", stamps: "0" });
	});

	it("refuses to send a template without a required text parameter", () => {
		expect(() =>
			templateData("voucher", {
				reward_name: "Một ly",
				expires_at: "21:00 20/11/2026",
			}),
		).toThrow(TemplateParameterError);
	});

	it("renders the consultation text of a kind, and none for a promotion", () => {
		expect(
			consultationText("voucher_expiring", {
				customer_name: "Synthetic A",
				reward_name: "Một ly nước",
				voucher_code: "SYN00001",
				expires_at: "21:00 20/11/2026",
			}),
		).toBe(
			"Chào Synthetic A, ưu đãi Một ly nước với mã SYN00001 sẽ hết hạn lúc 21:00 20/11/2026. Hãy dùng trước khi hết hạn nhé.",
		);
		expect(() =>
			consultationText("win_back", { customer_name: "A", inactive_days: 45 }),
		).toThrow(TemplateParameterError);
	});
});
