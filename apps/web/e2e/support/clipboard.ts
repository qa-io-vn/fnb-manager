import type { Page } from "@playwright/test";

export async function clipboardText(page: Page): Promise<string> {
	const text = await page.evaluate(() => navigator.clipboard.readText());
	return text.replaceAll("\r\n", "\n");
}
