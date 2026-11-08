import { expect, test } from "@playwright/test";

const middayInHoChiMinhCity = new Date("2026-11-04T05:30:00.000Z");

interface ManifestIcon {
	src: string;
	sizes: string;
	type: string;
	purpose: string;
}

interface WebManifest {
	name: string;
	short_name: string;
	start_url: string;
	scope: string;
	display: string;
	icons: ManifestIcon[];
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(middayInHoChiMinhCity);
});

test("the Pages demo build serves its icons and manifest under the base path", async ({
	page,
	baseURL,
}) => {
	const failed: string[] = [];
	page.on("response", (response) => {
		if (response.status() >= 400) {
			failed.push(`${response.status()} ${new URL(response.url()).pathname}`);
		}
	});
	await page.goto("./");
	await expect(page.getByTestId("card-today-net_revenue")).toBeVisible();
	const base = new URL(baseURL ?? "");

	const iconLinks = await page
		.locator('link[rel="icon"], link[rel="apple-touch-icon"]')
		.evaluateAll((links) =>
			links.map((link) => (link as HTMLLinkElement).href),
		);
	expect(iconLinks).toHaveLength(3);
	for (const href of iconLinks) {
		expect(new URL(href).pathname.startsWith(base.pathname), href).toBe(true);
		expect((await page.request.get(href)).status(), href).toBe(200);
	}

	const manifestHref = await page
		.locator('link[rel="manifest"]')
		.getAttribute("href");
	const manifestUrl = new URL(manifestHref ?? "", page.url());
	expect(manifestUrl.pathname).toBe(`${base.pathname}manifest.webmanifest`);
	const response = await page.request.get(manifestUrl.href);
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain(
		"application/manifest+json",
	);
	const manifest = (await response.json()) as WebManifest;
	expect(manifest.name).toBe("FNB Manager");
	expect(manifest.display).toBe("standalone");
	expect(new URL(manifest.start_url, manifestUrl).href).toBe(base.href);
	expect(new URL(manifest.scope, manifestUrl).href).toBe(base.href);
	for (const icon of manifest.icons) {
		const iconResponse = await page.request.get(
			new URL(icon.src, manifestUrl).href,
		);
		expect(iconResponse.status(), icon.src).toBe(200);
		expect(iconResponse.headers()["content-type"], icon.src).toBe(icon.type);
	}

	const devtools = await page.context().newCDPSession(page);
	const parsed = await devtools.send("Page.getAppManifest");
	expect(parsed.url).toBe(manifestUrl.href);
	expect(parsed.errors).toEqual([]);
	expect(failed).toEqual([]);
});
