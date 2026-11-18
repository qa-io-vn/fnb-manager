import type * as Sdk from "zmp-sdk";
import { MOCK_CALLS_GLOBAL } from "./constants";

export { EXTERNAL_OPEN_APIS, MOCK_CALLS_GLOBAL } from "./constants";

export interface MockSdkCall {
	readonly api: string;
	readonly args: unknown;
}

export const MOCK_ZALO_ACCESS_TOKEN = "mock-zalo-access-token";
export const MOCK_PHONE_TOKEN = "mock-phone-token";
export const MOCK_PERMISSION_DENIED_CODE = -201;
const MOCK_STORAGE_LIMIT_KB = 5120;

const calls: MockSdkCall[] = [];
const storage = new Map<string, string>();

function publish(): void {
	if (typeof window === "undefined") return;
	Object.assign(window, { [MOCK_CALLS_GLOBAL]: calls.map((call) => call) });
}

function record(api: string, args?: unknown): void {
	let copy: unknown = null;
	if (args !== undefined) {
		try {
			copy = JSON.parse(JSON.stringify(args));
		} catch {
			copy = String(args);
		}
	}
	calls.push({ api, args: copy });
	publish();
}

export function mockSdkCalls(): readonly MockSdkCall[] {
	return calls.map((call) => call);
}

export function resetMockSdk(): void {
	calls.length = 0;
	storage.clear();
	publish();
}

function searchParam(name: string): string | null {
	if (typeof location === "undefined") return null;
	return new URLSearchParams(location.search).get(name);
}

function prefersDark(): boolean {
	return (
		typeof matchMedia === "function" &&
		matchMedia("(prefers-color-scheme: dark)").matches
	);
}

function storedBytes(): number {
	let total = 0;
	for (const [key, value] of storage) total += key.length + value.length;
	return total;
}

export const nativeStorage: typeof Sdk.nativeStorage = {
	getItem: (key) => storage.get(key) ?? "",
	setItem: (key, value) => {
		storage.set(key, value);
	},
	removeItem: (key) => {
		storage.delete(key);
	},
	clear: () => {
		storage.clear();
	},
	getStorageInfo: () => ({
		currentSize: Math.ceil(storedBytes() / 1024),
		limitSize: MOCK_STORAGE_LIMIT_KB,
	}),
};

export function mockAccessToken(): string {
	const local = import.meta.env.VITE_ZALO_MOCK_ACCESS_TOKEN;
	return typeof local === "string" && local !== ""
		? local
		: MOCK_ZALO_ACCESS_TOKEN;
}

export const getAccessToken: typeof Sdk.getAccessToken = async (args) => {
	record("getAccessToken");
	const token = mockAccessToken();
	args?.success?.(token);
	return token;
};

export const getSystemInfo: typeof Sdk.getSystemInfo = () => {
	const language =
		searchParam("lang") ??
		(typeof navigator === "undefined" ? "vi" : navigator.language);
	return {
		version: "0.0.0",
		apiVersion: "0.0.0",
		zaloVersion: "0",
		platform: "",
		language,
		zaloLanguage: language.toLowerCase().startsWith("en") ? "en" : "vi",
		zaloTheme: prefersDark() ? "dark" : "light",
	};
};

export const getPhoneNumber: typeof Sdk.getPhoneNumber = async (args) => {
	record("getPhoneNumber");
	if (searchParam("phone") === "refused") {
		const failure = {
			code: MOCK_PERMISSION_DENIED_CODE,
			message: "User denied the permission",
		};
		args?.fail?.(failure);
		throw failure;
	}
	const result = { token: MOCK_PHONE_TOKEN };
	args?.success?.(result);
	return result;
};

export const MOCK_CANCELLED_CODE = -1;
export const MOCK_CAMERA_INPUT_ID = "mock-camera-input";

function pickFile(cameraOnly: boolean): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		if (cameraOnly) input.setAttribute("capture", "environment");
		input.id = MOCK_CAMERA_INPUT_ID;
		input.hidden = true;
		input.tabIndex = -1;
		input.setAttribute("aria-hidden", "true");
		document.body.append(input);
		const done = (file: File | null) => {
			input.remove();
			resolve(file);
		};
		input.addEventListener("change", () => done(input.files?.[0] ?? null), {
			once: true,
		});
		input.addEventListener("cancel", () => done(null), { once: true });
		input.click();
	});
}

export const chooseImage: typeof Sdk.chooseImage = async (args) => {
	record("chooseImage", {
		sourceType: args.sourceType ?? null,
		cameraType: args.cameraType ?? null,
		count: args.count,
	});
	if (searchParam("camera") === "refused") {
		const failure = {
			code: MOCK_PERMISSION_DENIED_CODE,
			message: "User denied the permission",
		};
		args.fail?.(failure);
		throw failure;
	}
	const sources = args.sourceType ?? ["album", "camera"];
	const file = await pickFile(!sources.includes("album"));
	if (file === null) {
		const failure = { code: MOCK_CANCELLED_CODE, message: "User cancelled" };
		args.fail?.(failure);
		throw failure;
	}
	const path = URL.createObjectURL(file);
	const result = { filePaths: [path], tempFiles: [{ path, size: file.size }] };
	args.success?.(result);
	return result;
};

export const openWebview: typeof Sdk.openWebview = async (args) => {
	record("openWebview", args);
};

export const openOutApp: typeof Sdk.openOutApp = async (args) => {
	record("openOutApp", args);
};

export const openMiniApp: typeof Sdk.openMiniApp = async (args) => {
	record("openMiniApp", args);
};

export const openPhone: typeof Sdk.openPhone = async (args) => {
	record("openPhone", args);
};

export const openSMS: typeof Sdk.openSMS = async (args) => {
	record("openSMS", args);
};

export const openChat: typeof Sdk.openChat = async (args) => {
	record("openChat", args);
};

export const openProfile: typeof Sdk.openProfile = async (args) => {
	record("openProfile", args);
};
