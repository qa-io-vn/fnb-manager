import { beforeEach, describe, expect, it } from "vitest";
import {
	EXTERNAL_OPEN_APIS,
	getAccessToken,
	getPhoneNumber,
	getSystemInfo,
	MOCK_CALLS_GLOBAL,
	MOCK_PHONE_TOKEN,
	MOCK_ZALO_ACCESS_TOKEN,
	mockSdkCalls,
	nativeStorage,
	openOutApp,
	openWebview,
	resetMockSdk,
} from "../../src/testing/mock-sdk";

describe("mocked Zalo SDK", () => {
	beforeEach(() => {
		resetMockSdk();
	});

	it("records external-open calls such as openWebview and openOutApp", async () => {
		await openWebview({ url: "https://example.com/" });
		await openOutApp({ url: "https://example.com/" });
		expect(mockSdkCalls()).toEqual([
			{ api: "openWebview", args: { url: "https://example.com/" } },
			{ api: "openOutApp", args: { url: "https://example.com/" } },
		]);
		expect(
			mockSdkCalls().every((call) => EXTERNAL_OPEN_APIS.includes(call.api)),
		).toBe(true);
		expect(
			(window as unknown as Record<string, unknown>)[MOCK_CALLS_GLOBAL],
		).toEqual(mockSdkCalls());
	});

	it("answers getAccessToken and getPhoneNumber with synthetic tokens", async () => {
		const success: string[] = [];
		expect(
			await getAccessToken({ success: (token) => success.push(token) }),
		).toBe(MOCK_ZALO_ACCESS_TOKEN);
		expect(await getPhoneNumber()).toEqual({ token: MOCK_PHONE_TOKEN });
		expect(success).toEqual([MOCK_ZALO_ACCESS_TOKEN]);
		expect(mockSdkCalls().map((call) => call.api)).toEqual([
			"getAccessToken",
			"getPhoneNumber",
		]);
	});

	it("keeps Native Storage in memory, with Zalo's empty string for a missing key", () => {
		expect(nativeStorage.getItem("fnb.session")).toBe("");
		nativeStorage.setItem("fnb.session", "{}");
		expect(nativeStorage.getItem("fnb.session")).toBe("{}");
		expect(nativeStorage.getStorageInfo()).toEqual({
			currentSize: 1,
			limitSize: 5120,
		});
		resetMockSdk();
		expect(nativeStorage.getItem("fnb.session")).toBe("");
	});

	it("reports the language and theme of the browser", () => {
		const info = getSystemInfo();
		expect(["vi", "en"]).toContain(info.zaloLanguage);
		expect(info.zaloTheme).toBe("light");
	});
});
