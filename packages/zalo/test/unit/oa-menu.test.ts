import { describe, expect, it } from "vitest";
import {
	DEFAULT_OA_MENU,
	diffLines,
	keywordAction,
	menuChanged,
	menuDiff,
	menuDigest,
	miniAppDeepLink,
	OaConfigError,
	oaTextValid,
	parseMenuButtons,
	parseMenuConfig,
	parseZaloButtons,
	zaloButtons,
} from "../../src/oa/menu.js";
import { textMessage, userInfoRequest } from "../../src/oa/messages.js";

const MINI_APP = "synthetic-mini-app-1";
const IMAGE = "https://example.com/brand-logo.png";

describe("OA menu buttons", () => {
	it("renders join as a hidden OA keyword and the others as Mini App deep links", () => {
		expect(zaloButtons(DEFAULT_OA_MENU.buttons, MINI_APP)).toEqual([
			{ title: "Tham gia thành viên", type: "oa.query.hide", payload: "#join" },
			{
				title: "Điểm của tôi",
				type: "oa.open.url",
				payload: {
					url: "https://zalo.me/s/synthetic-mini-app-1/the-thanh-vien?src=oa",
				},
			},
			{
				title: "Voucher của tôi",
				type: "oa.open.url",
				payload: {
					url: "https://zalo.me/s/synthetic-mini-app-1/vi-voucher?src=oa",
				},
			},
			{
				title: "Mở ứng dụng thành viên",
				type: "oa.open.url",
				payload: { url: "https://zalo.me/s/synthetic-mini-app-1/?src=oa" },
			},
		]);
	});

	it("drops the deep links when the brand has no customer Mini App", () => {
		expect(zaloButtons(DEFAULT_OA_MENU.buttons, null)).toEqual([
			{ title: "Tham gia thành viên", type: "oa.query.hide", payload: "#join" },
		]);
	});

	it("refuses a link that is not a Mini App deep link or a keyword, twice the same action, and too many buttons", () => {
		expect(() =>
			parseMenuButtons([{ action: "points", label: "Điểm", target: "query" }]),
		).toThrow(OaConfigError);
		expect(() =>
			parseMenuButtons([
				{ action: "join", label: "Một", target: "query" },
				{ action: "join", label: "Hai", target: "mini_app" },
			]),
		).toThrow(/appears twice/);
		expect(() =>
			parseMenuButtons([
				{ action: "open_app", label: "Web", target: "mini_app", url: "x" },
			]),
		).toThrow(/fields other than/);
		expect(() =>
			parseMenuButtons([
				{
					action: "open_app",
					label: "Xem https://example.com",
					target: "mini_app",
				},
			]),
		).toThrow(/label/);
		expect(() => parseMenuButtons([])).toThrow(/1 to 5/);
		expect(() => miniAppDeepLink("bad id/../x", "points")).toThrow(
			OaConfigError,
		);
	});

	it("reads only exact keywords, whatever the case and spaces", () => {
		expect(keywordAction(" #JOIN ")).toBe("join");
		expect(keywordAction("#join please")).toBeNull();
		expect(keywordAction(42)).toBeNull();
	});

	it("keeps texts free of links, phone numbers and control characters", () => {
		expect(oaTextValid("Cảm ơn bạn đã quan tâm.", 100)).toBe(true);
		expect(oaTextValid("Gọi 0900 000 123 nhé", 100)).toBe(false);
		expect(oaTextValid("Xem www.example.com", 100)).toBe(false);
		expect(oaTextValid("Mở zalo.me/s/123", 100)).toBe(false);
		expect(oaTextValid("Dòng một\nDòng hai", 100)).toBe(true);
		expect(oaTextValid("chuông\u0007", 100)).toBe(false);
		expect(oaTextValid(" khoảng trắng", 100)).toBe(false);
		expect(oaTextValid("x".repeat(101), 100)).toBe(false);
	});
});

describe("OA menu configuration", () => {
	it("takes the defaults for missing texts and needs a form image for the join form", () => {
		expect(() => parseMenuConfig({})).toThrow(/form_image_url/);
		const config = parseMenuConfig({ form_image_url: IMAGE });
		expect(config.buttons).toEqual(DEFAULT_OA_MENU.buttons);
		expect(config.welcomeText).toBe(DEFAULT_OA_MENU.welcomeText);
		expect(
			parseMenuConfig({
				buttons: [{ action: "join", label: "Tham gia", target: "mini_app" }],
			}).formImageUrl,
		).toBeNull();
	});

	it("refuses unknown fields, an http image and a text with a phone number", () => {
		expect(() => parseMenuConfig({ form_image_url: IMAGE, extra: 1 })).toThrow(
			/unknown fields: extra/,
		);
		expect(() =>
			parseMenuConfig({ form_image_url: "http://example.com/logo.png" }),
		).toThrow(/https/);
		expect(() =>
			parseMenuConfig({
				form_image_url: IMAGE,
				welcome_text: "Liên hệ 0900000123",
			}),
		).toThrow(/welcome_text/);
	});
});

describe("OA menu diff", () => {
	const configured = zaloButtons(DEFAULT_OA_MENU.buttons, MINI_APP);

	it("lists every button as added before the first apply", () => {
		const changes = menuDiff(null, configured);
		expect(changes.map((change) => change.kind)).toEqual([
			"added",
			"added",
			"added",
			"added",
		]);
		expect(menuChanged(changes)).toBe(true);
	});

	it("reports nothing to do once the applied menu equals the configuration", async () => {
		const changes = menuDiff(configured, configured);
		expect(menuChanged(changes)).toBe(false);
		expect(await menuDigest(configured)).toBe(
			await menuDigest([...configured]),
		);
	});

	it("names changed and removed buttons, and numbers them without labels or links in CI", () => {
		const before = parseZaloButtons(JSON.parse(JSON.stringify(configured)));
		expect(before).toEqual(configured);
		const after = configured
			.slice(0, 2)
			.map((button, index) =>
				index === 1 ? { ...button, title: "Điểm" } : button,
			);
		const changes = menuDiff(before, after);
		expect(diffLines(changes, false)).toEqual([
			'  1. unchanged "Tham gia thành viên" → keyword #join',
			'  2. ~ "Điểm của tôi" → https://zalo.me/s/synthetic-mini-app-1/the-thanh-vien?src=oa becomes "Điểm" → https://zalo.me/s/synthetic-mini-app-1/the-thanh-vien?src=oa',
			'  3. - "Voucher của tôi" → https://zalo.me/s/synthetic-mini-app-1/vi-voucher?src=oa',
			'  4. - "Mở ứng dụng thành viên" → https://zalo.me/s/synthetic-mini-app-1/?src=oa',
		]);
		expect(diffLines(changes, true)).toEqual([
			"  1. unchanged OA keyword",
			"  2. ~ Mini App link becomes Mini App link",
			"  3. - Mini App link",
			"  4. - Mini App link",
		]);
	});

	it("reads back only well-formed stored buttons", () => {
		expect(
			parseZaloButtons([{ title: "x", type: "oa.open.phone", payload: {} }]),
		).toBeNull();
		expect(parseZaloButtons("menu")).toBeNull();
	});
});

describe("OA consultation messages", () => {
	it("builds a text with buttons and the request_user_info form", () => {
		const buttons = zaloButtons(DEFAULT_OA_MENU.buttons, MINI_APP);
		expect(textMessage("oa-user-1", "Xin chào", buttons)).toEqual({
			recipient: { user_id: "oa-user-1" },
			message: {
				text: "Xin chào",
				attachment: { type: "template", payload: { buttons } },
			},
		});
		expect(textMessage("oa-user-1", "Xin chào", [])).toEqual({
			recipient: { user_id: "oa-user-1" },
			message: { text: "Xin chào" },
		});
		expect(
			userInfoRequest("oa-user-1", {
				title: "Tham gia",
				subtitle: "Chia sẻ tên và số điện thoại",
				imageUrl: IMAGE,
			}).message,
		).toEqual({
			attachment: {
				type: "template",
				payload: {
					template_type: "request_user_info",
					elements: [
						{
							title: "Tham gia",
							subtitle: "Chia sẻ tên và số điện thoại",
							image_url: IMAGE,
						},
					],
				},
			},
		});
	});

	it("refuses a malformed recipient, a text with a link and a form without an https image", () => {
		expect(() => textMessage("bad user", "Xin chào", [])).toThrow(
			OaConfigError,
		);
		expect(() => textMessage("u1", "Xem https://example.com", [])).toThrow(
			OaConfigError,
		);
		expect(() =>
			userInfoRequest("u1", {
				title: "Tham gia",
				subtitle: "Chia sẻ",
				imageUrl: "ftp://example.com/x.png",
			}),
		).toThrow(OaConfigError);
	});
});
