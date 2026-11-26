import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { run as runListing } from "../../src/listing/cli";
import {
	decodePng,
	descriptionProblems,
	isListed,
	type Listing,
	ListingConfigError,
	listingProblems,
	loadListings,
	logoProblems,
	nameProblems,
	readListings,
	SYNTHETIC_LISTING_CONFIGS,
	selectListing,
} from "../../src/listing/index";
import { encodePng, hex, markLogo, type Rgba } from "./png-fixture";

const packageRoot = join(import.meta.dirname, "..", "..");
const workspace = mkdtempSync(join(tmpdir(), "fnb-listing-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const listings = loadListings(SYNTHETIC_LISTING_CONFIGS);
const brandOne = selectListing(listings, "brand-1");

function listing(overrides: Partial<Listing>): Listing {
	return { ...brandOne, ...overrides };
}

const solid = (color: string) => () => hex(color);

describe("listing rules", () => {
	it("pass for the three synthetic brands' customer Mini Apps", () => {
		const listed = listings.filter(isListed);
		expect(listed.map((entry) => `${entry.brandKey} ${entry.kind}`)).toEqual([
			"brand-1 customer",
			"brand-2 customer",
			"brand-3 customer",
		]);
		for (const entry of listed) expect(listingProblems(entry)).toEqual([]);
		expect(brandOne).toMatchObject({
			miniAppId: "synthetic-customer-1",
			name: "Thành viên Quán Mẫu Một",
			ownerMark: "Quán Mẫu Một",
			category: "FNB",
			stores: [
				{ code: "mau-1", name: "Cửa hàng Mẫu 1" },
				{ code: "mau-2", name: "Cửa hàng Mẫu 2" },
			],
		});
	});

	it("fail on a synthetic name containing App, Mini App or Zalo", () => {
		for (const name of [
			"Quán Mẫu Một App",
			"Mini App Quán Mẫu Một",
			"Quán Mẫu Một trên Zalo",
		]) {
			expect(nameProblems(name, "Quán Mẫu Một")).toContain(
				"the name must not contain Zalo, App or Mini App",
			);
		}
		expect(
			listingProblems(listing({ name: "Thành viên Quán Mẫu Một App" })),
		).not.toEqual([]);
	});

	it("fail on a description under 20 characters, over 500 or with a link", () => {
		expect(descriptionProblems("Tích điểm ở quán.")).toEqual([
			"the description must be 20 to 500 characters; it has 17",
		]);
		expect(listingProblems(listing({ description: "Quán ngon." }))).toEqual([
			"the description must be 20 to 500 characters; it has 10",
		]);
		expect(descriptionProblems("a".repeat(501))).toHaveLength(1);
		expect(descriptionProblems("a".repeat(500))).toEqual([]);
		expect(
			descriptionProblems("Tích điểm tại quán, xem thêm ở https://example.com"),
		).toContain("the description must not contain a link");
		expect(
			descriptionProblems("Tích điểm tại quán, xem thêm ở quanmau.vn nhé"),
		).toContain("the description must not contain a link");
		expect(descriptionProblems(null)).toEqual(["description is required"]);
	});

	it("need the owner's mark in the name, the FNB category and a logo", () => {
		expect(nameProblems("Thành viên Quán Mẫu Một", null)).toEqual([
			"owner_mark is required: the part of the name that identifies the business, as the owner confirmed it",
		]);
		expect(nameProblems("Thành viên Quán Mẫu Một", "Quán Mẫu Hai")).toEqual([
			'the name must contain the owner\'s mark "Quán Mẫu Hai"',
		]);
		expect(nameProblems("thành viên quán mẫu một", "Quán Mẫu Một")).toEqual([]);
		expect(nameProblems("THÀNH VIÊN QUÁN", "Quán")).toContain(
			"the name must not be written in capitals only",
		);
		expect(nameProblems("Quán Mẫu Một ☕", "Quán Mẫu Một")).toContain(
			"the name must not contain emoji or special characters",
		);
		expect(nameProblems("QM", "QM")).toContain(
			"the name must be 3 to 50 characters",
		);
		expect(listingProblems(listing({ category: "SHOPPING" }))).toEqual([
			"the category must be FNB for a food and drink business; it is SHOPPING",
		]);
		expect(listingProblems(listing({ category: null, logo: null }))).toEqual([
			"category is required: FNB",
			"logo is required: a PNG file",
		]);
	});

	it("read the private brand file's shape, with the brand on top and the Mini App id on the row", () => {
		const read = readListings({
			brand: "brand-7",
			name: "Quán Mẫu Bảy",
			stores: ["store-1"],
			mini_apps: [
				{ kind: "staff", id: "s-7", title: "Nhân viên Quán Mẫu Bảy" },
				{
					kind: "customer",
					id: "c-7",
					title: "Thành viên Quán Mẫu Bảy",
					stores: [
						{ code: "Q7.1", name: "Cửa hàng 1" },
						{ code: "Q7.1", name: "Again" },
						{ code: "../x", name: "Bad" },
					],
				},
			],
		});
		expect(
			read.map((entry) => [entry.brandKey, entry.kind, isListed(entry)]),
		).toEqual([
			["brand-7", "staff", false],
			["brand-7", "customer", true],
		]);
		const customer = selectListing(read, "brand-7");
		expect(customer.miniAppId).toBe("c-7");
		expect(customer.stores).toEqual([{ code: "Q7.1", name: "Cửa hàng 1" }]);
		expect(customer.problems).toEqual([
			"store Q7.1 is listed twice",
			"store 3: code must be the store's link key, 1 to 64 of A-Z, a-z, 0-9, ., _ and -",
		]);
		expect(() => selectListing(read, "brand-8")).toThrow(ListingConfigError);
		const merged = readListings(
			{
				mini_apps: [
					{
						brand_key: "brand-3",
						kind: "customer",
						title: "Thành viên Quán Ba",
					},
				],
			},
			{
				listings: [
					{
						brand_key: "brand-3",
						kind: "customer",
						owner_mark: "Quán Ba",
						category: "FNB",
					},
				],
			},
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({
			name: "Thành viên Quán Ba",
			ownerMark: "Quán Ba",
			category: "FNB",
		});
		expect(() => readListings({ listings: [] })).toThrow(
			"the configuration needs a mini_apps list",
		);
		expect(() => readListings({})).toThrow(ListingConfigError);
		expect(() =>
			readListings({ mini_apps: [{ brand_key: "brand-1", kind: "web" }] }),
		).toThrow("kind must be staff or customer");
	});
});

describe("the logo check", () => {
	it("passes a square logo on one solid, opaque background", () => {
		const logo = readFileSync(
			join(packageRoot, "config", "logos", "brand-1-customer.png"),
		);
		expect(logoProblems(logo)).toEqual({ problems: [], notes: [] });
		const decoded = decodePng(logo);
		expect([decoded.width, decoded.height]).toEqual([512, 512]);
		expect(decoded.pixel(0, 0)).toEqual(hex("#0A6B56"));
		expect(decoded.pixel(255, 120)).toEqual(hex("#FFFFFF"));
	});

	it("refuses a transparent background, even when it is only see-through", () => {
		const clear: Rgba = [255, 255, 255, 0];
		const transparent = encodePng(
			300,
			300,
			(x, y) => (Math.hypot(x - 150, y - 150) < 80 ? hex("#0A6B56") : clear),
			{ alpha: true },
		);
		expect(logoProblems(transparent).problems).toEqual([
			expect.stringContaining("transparent or see-through pixels"),
		]);
		const faded = encodePng(300, 300, () => [10, 107, 86, 200], {
			alpha: true,
		});
		expect(logoProblems(faded).problems).toHaveLength(1);
		const opaque = encodePng(300, 300, solid("#0A6B56"), { alpha: true });
		expect(logoProblems(opaque).problems).toEqual([]);
	});

	it("refuses a logo that is not square, has no solid background or is not a PNG", () => {
		expect(
			logoProblems(encodePng(400, 300, solid("#F6F4EF"))).problems,
		).toEqual(["the logo must be square; it is 400 × 300 px"]);
		const gradient = encodePng(300, 300, (x) => [x % 256, 40, 40, 255]);
		expect(logoProblems(gradient).problems).toEqual([
			"the logo's corners differ; it needs one solid background colour",
		]);
		expect(logoProblems(Buffer.from("<svg/>")).problems).toEqual([
			"the logo is not a PNG file",
		]);
		expect(
			logoProblems(encodePng(64, 64, markLogo(64, "#F6F4EF", "#121114"))),
		).toEqual({
			problems: [],
			notes: ["the logo is 64 × 64 px; 256 × 256 px or larger keeps it sharp"],
		});
	});
});

describe("the listing command", () => {
	const run = (args: readonly string[]) => {
		const lines: string[] = [];
		const capture = (...parts: unknown[]) => {
			lines.push(parts.map(String).join(" "));
		};
		const log = vi.spyOn(console, "log").mockImplementation(capture);
		const error = vi.spyOn(console, "error").mockImplementation(capture);
		const previous = process.env.INIT_CWD;
		process.env.INIT_CWD = workspace;
		try {
			return { code: runListing(args), out: lines.join("\n") };
		} finally {
			log.mockRestore();
			error.mockRestore();
			if (previous === undefined) delete process.env.INIT_CWD;
			else process.env.INIT_CWD = previous;
		}
	};

	it("passes the synthetic brands and lists the owner's checklist", () => {
		const result = run([]);
		expect(result.code).toBe(0);
		expect(result.out).toContain(
			'brand-1 customer "Thành viên Quán Mẫu Một": ok',
		);
		expect(result.out).toContain(
			'brand-2 customer "Thành viên Quán Mẫu Hai": ok',
		);
		expect(result.out).toContain(
			'brand-3 customer "Thành viên Quán Mẫu Ba": ok',
		);
		expect(result.out).toContain(
			"[ ] the logo is the brand's own mark and shows no QR code and no phone number",
		);
	});

	it("fails a configuration whose name contains App and whose description is short", () => {
		const logo = join(workspace, "logo.png");
		writeFileSync(logo, encodePng(300, 300, solid("#0A6B56")));
		const config = join(workspace, "bad.json");
		writeFileSync(
			config,
			JSON.stringify({
				mini_apps: [
					{
						brand_key: "brand-9",
						kind: "customer",
						title: "Quán Mẫu Chín App",
						owner_mark: "Quán Mẫu Chín",
						description: "Quán ngon.",
						category: "FNB",
						logo: "logo.png",
					},
				],
			}),
		);
		const result = run(["--config", "bad.json"]);
		expect(result.code).toBe(1);
		expect(result.out).toContain(
			'brand-9 customer "Quán Mẫu Chín App": 2 problem(s)',
		);
		expect(result.out).toContain(
			"the name must not contain Zalo, App or Mini App",
		);
		expect(result.out).toContain(
			"the description must be 20 to 500 characters; it has 10",
		);
		expect(run(["--config", "bad.json", "--brand", "brand-1"]).code).toBe(1);
		expect(() => run(["--unknown"])).toThrow(TypeError);
	});
});
