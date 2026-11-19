import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadListings,
	SYNTHETIC_LISTING_CONFIGS,
	selectListing,
} from "@fnb/zalo-mini/listing";
import { afterAll, describe, expect, it } from "vitest";
import {
	miniAppLink,
	storeDeepLink,
	storeLinkFromPath,
} from "../src/data/link";
import { qrPath } from "../src/wallet/qr-path";
import {
	buildStandee,
	escapeXml,
	STANDEE_QR_BORDER,
	STANDEE_QR_ECC,
	standeeFileName,
} from "./standee";
import {
	insideRepository,
	linkBaseFor,
	REPOSITORY_ROOT,
	run,
	StandeeError,
	standeesFor,
	storesFrom,
} from "./standees";

const workspace = mkdtempSync(join(tmpdir(), "fnb-standee-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const listings = loadListings(SYNTHETIC_LISTING_CONFIGS);
const brandOne = selectListing(listings, "brand-1");

describe("store deep links", () => {
	it("open the store's page in the customer Mini App", () => {
		const link = storeDeepLink(
			miniAppLink("synthetic-customer-1"),
			"mau-1",
			"standee",
		);
		expect(link).toBe(
			"https://zalo.me/s/synthetic-customer-1/?store=mau-1&src=standee",
		);
		expect(storeLinkFromPath(link)).toEqual({
			store: "mau-1",
			source: "standee",
		});
	});

	it("keep a Development link's own parameters and replace an older store", () => {
		const link = storeDeepLink(
			"https://zalo.me/s/123/?env=DEVELOPMENT&version=zdev-1&store=old&src=qr",
			"Q1.HN",
			"standee",
		);
		expect(link).toBe(
			"https://zalo.me/s/123/?env=DEVELOPMENT&version=zdev-1&store=Q1.HN&src=standee",
		);
		expect(storeLinkFromPath(link)).toEqual({
			store: "Q1.HN",
			source: "standee",
		});
		expect(storeDeepLink("http://127.0.0.1:5751/", "mau-2", "qr")).toBe(
			"http://127.0.0.1:5751/?store=mau-2&src=qr",
		);
	});

	it("refuse a bad store code, a bad Mini App id and a link that is not a web address", () => {
		expect(() =>
			storeDeepLink("https://zalo.me/s/1/", "../x", "standee"),
		).toThrow("not a store link key");
		expect(() => miniAppLink("has space")).toThrow("Mini App id");
		expect(() => storeDeepLink("javascript:alert(1)", "mau-1", "qr")).toThrow(
			"https://",
		);
	});
});

describe("the standee", () => {
	const standee = buildStandee(
		{
			displayName: "Quán Mẫu Một",
			headerColor: "#0A6B56",
			textColor: "white",
		},
		{ code: "mau-1", name: "Cửa hàng <Mẫu> 1" },
		"https://zalo.me/s/synthetic-customer-1/",
	);

	it("draws the store's deep link as its QR code, with a print quiet zone", () => {
		expect(standee.link).toBe(
			"https://zalo.me/s/synthetic-customer-1/?store=mau-1&src=standee",
		);
		const qr = qrPath(standee.link, {
			ecc: STANDEE_QR_ECC,
			border: STANDEE_QR_BORDER,
		});
		expect(standee.svg).toContain(`<path d="${qr.path}" fill="#000000"/>`);
		expect(standee.svg).toContain('data-store="mau-1"');
		expect(standee.svg).toContain('width="105mm" height="148mm"');
	});

	it("carries the brand, the store and a generic Vietnamese call to action, escaped", () => {
		expect(standee.svg).toContain(">Quán Mẫu Một</text>");
		expect(standee.svg).toContain(">Cửa hàng &lt;Mẫu&gt; 1</text>");
		expect(standee.svg).toContain(">Quét mã bằng Zalo</text>");
		expect(standee.svg).toContain('fill="#0A6B56"');
		expect(standee.svg).not.toMatch(/₫|đồng|giá/i);
		expect(escapeXml(`a&b"'`)).toBe("a&amp;b&quot;&apos;");
		expect(standeeFileName("Q1.HN")).toBe("standee-Q1.HN");
	});
});

describe("the standee command", () => {
	it("takes the stores and the Mini App id from the brand configuration", () => {
		const stores = storesFrom(brandOne, []);
		expect(stores.map((store) => store.code)).toEqual(["mau-1", "mau-2"]);
		const made = standeesFor(
			brandOne,
			stores,
			linkBaseFor(brandOne, undefined),
		);
		expect(made.map((entry) => entry.link)).toEqual([
			"https://zalo.me/s/synthetic-customer-1/?store=mau-1&src=standee",
			"https://zalo.me/s/synthetic-customer-1/?store=mau-2&src=standee",
		]);
		expect(made[0]?.svg).toContain(">Cửa hàng Mẫu 1</text>");
	});

	it("takes named stores and another link base, and needs an id or a base", () => {
		expect(storesFrom(brandOne, ["sim-1=Synthetic store 1", "mau-2"])).toEqual([
			{ code: "sim-1", name: "Synthetic store 1" },
			{ code: "mau-2", name: "Cửa hàng Mẫu 2" },
		]);
		expect(() => storesFrom(brandOne, ["a b"])).toThrow(StandeeError);
		expect(() => storesFrom({ ...brandOne, stores: [] }, [])).toThrow(
			"lists no stores",
		);
		expect(linkBaseFor(brandOne, "http://127.0.0.1:5751/")).toBe(
			"http://127.0.0.1:5751/",
		);
		expect(() =>
			linkBaseFor({ ...brandOne, miniAppId: null }, undefined),
		).toThrow("has no id yet");
	});

	it("writes outside the repository only", async () => {
		expect(insideRepository(REPOSITORY_ROOT)).toBe(true);
		expect(insideRepository(join(REPOSITORY_ROOT, "docs", "x"))).toBe(true);
		expect(insideRepository(workspace)).toBe(false);
		await expect(
			run(["--brand", "brand-1", "--out", join(REPOSITORY_ROOT, "standees")]),
		).rejects.toThrow("inside the repository");
		const out = join(workspace, "brand-2");
		expect(await run(["--brand", "brand-2", "--out", out])).toBe(0);
		const svg = readFileSync(join(out, "standee-hai-1.svg"), "utf8");
		expect(svg).toContain(
			'data-link="https://zalo.me/s/synthetic-customer-2/?store=hai-1&amp;src=standee"',
		);
		expect(existsSync(join(out, "standee-hai-1.pdf"))).toBe(false);
	});
});
