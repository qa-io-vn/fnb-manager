export interface NativeStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface ZmpNativeStorage {
	getItem(key: string): string;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export function fromZmpNativeStorage(storage: ZmpNativeStorage): NativeStorage {
	return {
		getItem(key) {
			const value = storage.getItem(key);
			return typeof value === "string" && value.length > 0 ? value : null;
		},
		setItem(key, value) {
			storage.setItem(key, value);
		},
		removeItem(key) {
			storage.removeItem(key);
		},
	};
}

export function createMemoryStorage(): NativeStorage {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
	};
}

export interface SupabaseAuthStorageOptions {
	readonly storage: NativeStorage;
	readonly persistSession: true;
	readonly autoRefreshToken: true;
	readonly detectSessionInUrl: false;
}

export function supabaseAuthOptions(
	storage: NativeStorage,
): SupabaseAuthStorageOptions {
	return {
		storage,
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: false,
	};
}
