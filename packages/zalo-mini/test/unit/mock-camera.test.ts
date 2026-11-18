import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	chooseImage,
	MOCK_CAMERA_INPUT_ID,
	MOCK_CANCELLED_CODE,
	MOCK_PERMISSION_DENIED_CODE,
	mockSdkCalls,
	resetMockSdk,
} from "../../src/testing/mock-sdk";

function cameraInput(): HTMLInputElement {
	const input = document.getElementById(MOCK_CAMERA_INPUT_ID);
	if (!(input instanceof HTMLInputElement)) throw new Error("no camera input");
	return input;
}

describe("the mocked camera in browser mode", () => {
	const created: string[] = [];

	beforeEach(() => {
		resetMockSdk();
		window.history.replaceState(null, "", "/");
		URL.createObjectURL = vi.fn(() => {
			const url = `blob:mock/${created.length + 1}`;
			created.push(url);
			return url;
		});
	});

	afterEach(() => {
		window.history.replaceState(null, "", "/");
	});

	it("opens a hidden file input for the camera and answers with the chosen photo's path", async () => {
		const pending = chooseImage({
			sourceType: ["camera"],
			cameraType: "back",
			count: 1,
		});
		const input = cameraInput();
		expect(input.type).toBe("file");
		expect(input.accept).toBe("image/*");
		expect(input.getAttribute("capture")).toBe("environment");
		expect(input.hidden).toBe(true);
		const photo = new File([new Uint8Array(42)], "p.jpg", {
			type: "image/jpeg",
		});
		Object.defineProperty(input, "files", { value: [photo] });
		input.dispatchEvent(new Event("change"));
		expect(await pending).toEqual({
			filePaths: ["blob:mock/1"],
			tempFiles: [{ path: "blob:mock/1", size: 42 }],
		});
		expect(document.getElementById(MOCK_CAMERA_INPUT_ID)).toBeNull();
		expect(mockSdkCalls()).toEqual([
			{
				api: "chooseImage",
				args: { sourceType: ["camera"], cameraType: "back", count: 1 },
			},
		]);
	});

	it("answers a cancelled picker with a failure and leaves no input behind", async () => {
		const failures: unknown[] = [];
		const pending = chooseImage({
			count: 1,
			fail: (error) => failures.push(error),
		}).catch((error) => error);
		const input = cameraInput();
		expect(input.hasAttribute("capture")).toBe(false);
		input.dispatchEvent(new Event("cancel"));
		expect(await pending).toMatchObject({ code: MOCK_CANCELLED_CODE });
		expect(failures).toHaveLength(1);
		expect(document.getElementById(MOCK_CAMERA_INPUT_ID)).toBeNull();
	});

	it("refuses the camera with Zalo's permission code when the address says ?camera=refused", async () => {
		window.history.replaceState(null, "", "/?camera=refused");
		await expect(
			chooseImage({ sourceType: ["camera"], count: 1 }),
		).rejects.toMatchObject({ code: MOCK_PERMISSION_DENIED_CODE });
		expect(document.getElementById(MOCK_CAMERA_INPUT_ID)).toBeNull();
		expect(mockSdkCalls().map((call) => call.api)).toEqual(["chooseImage"]);
	});
});
