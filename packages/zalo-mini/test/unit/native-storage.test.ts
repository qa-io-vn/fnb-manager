import { describe, expect, it } from "vitest";
import {
	createMemoryStorage,
	fromZmpNativeStorage,
	supabaseAuthOptions,
	type ZmpNativeStorage,
} from "../../src/storage/native-storage";

function fakeZmpStorage(): ZmpNativeStorage & { readonly calls: string[] } {
	const values = new Map<string, string>();
	const calls: string[] = [];
	return {
		calls,
		getItem(key) {
			calls.push(`get ${key}`);
			return values.get(key) ?? "";
		},
		setItem(key, value) {
			calls.push(`set ${key}`);
			values.set(key, value);
		},
		removeItem(key) {
			calls.push(`remove ${key}`);
			values.delete(key);
		},
	};
}

describe("Native Storage adapter", () => {
	it("reads Zalo's empty string as a missing value and writes through", () => {
		const zmp = fakeZmpStorage();
		const storage = fromZmpNativeStorage(zmp);
		expect(storage.getItem("fnb.session")).toBeNull();
		storage.setItem("fnb.session", "{}");
		expect(storage.getItem("fnb.session")).toBe("{}");
		storage.removeItem("fnb.session");
		expect(storage.getItem("fnb.session")).toBeNull();
		expect(zmp.calls).toEqual([
			"get fnb.session",
			"set fnb.session",
			"get fnb.session",
			"remove fnb.session",
			"get fnb.session",
		]);
	});

	it("gives supabase-js a storage that never touches LocalStorage or cookies", () => {
		const storage = createMemoryStorage();
		const options = supabaseAuthOptions(storage);
		expect(options).toEqual({
			storage,
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: false,
		});
		options.storage.setItem("sb-auth-token", "value");
		expect(storage.getItem("sb-auth-token")).toBe("value");
	});
});
