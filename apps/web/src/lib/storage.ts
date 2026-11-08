type StorageArea = "local" | "session";

function areaOf(area: StorageArea): Storage {
	return area === "local" ? window.localStorage : window.sessionStorage;
}

export function readStoredJson<T>(
	key: string,
	parse: (value: unknown) => T | undefined,
	area: StorageArea = "local",
): T | undefined {
	try {
		const raw = areaOf(area).getItem(key);
		if (raw === null) return undefined;
		return parse(JSON.parse(raw));
	} catch {
		return undefined;
	}
}

export function writeStoredJson(
	key: string,
	value: unknown,
	area: StorageArea = "local",
): void {
	try {
		areaOf(area).setItem(key, JSON.stringify(value));
	} catch {
		return;
	}
}

export function removeStored(key: string, area: StorageArea = "local"): void {
	try {
		areaOf(area).removeItem(key);
	} catch {
		return;
	}
}
