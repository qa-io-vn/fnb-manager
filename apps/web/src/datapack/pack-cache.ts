export const PACK_KEY_PREFIX = "fnb.pack.";
export const OWNER_NOTE_KEY_PREFIX = "fnb.pack.owner-note.";
export const PACK_CACHE_SIZE = 5;
export const PACK_CACHE_DAYS = 14;

const DAY_MILLISECONDS = 86_400_000;
const PACK_KEY = /^fnb\.pack\.([0-9a-f]{64})$/;

export interface CachedPack {
	readonly packId: string;
	readonly text: string;
	readonly savedAt: number;
}

function deviceStorage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function packKey(packId: string): string {
	return `${PACK_KEY_PREFIX}${packId}`;
}

function remove(storage: Storage, key: string): void {
	try {
		storage.removeItem(key);
	} catch {
		return;
	}
}

function packKeys(storage: Storage): string[] {
	const keys: string[] = [];
	try {
		for (let index = 0; index < storage.length; index += 1) {
			const key = storage.key(index);
			if (key !== null && PACK_KEY.test(key)) keys.push(key);
		}
	} catch {
		return keys;
	}
	return keys;
}

function readEntry(storage: Storage, key: string): CachedPack | null {
	const packId = PACK_KEY.exec(key)?.[1];
	if (packId === undefined) return null;
	try {
		const raw = storage.getItem(key);
		const value: unknown = raw === null ? null : JSON.parse(raw);
		if (typeof value !== "object" || value === null) return null;
		const { text, savedAt } = value as { text?: unknown; savedAt?: unknown };
		return typeof text === "string" &&
			typeof savedAt === "number" &&
			Number.isFinite(savedAt)
			? { packId, text, savedAt }
			: null;
	} catch {
		return null;
	}
}

function isFresh(entry: CachedPack, now: Date): boolean {
	const age = now.getTime() - entry.savedAt;
	return age >= 0 && age <= PACK_CACHE_DAYS * DAY_MILLISECONDS;
}

export function cachedPacks(now: Date = new Date()): CachedPack[] {
	const storage = deviceStorage();
	if (storage === null) return [];
	const kept: CachedPack[] = [];
	for (const key of packKeys(storage)) {
		const entry = readEntry(storage, key);
		if (entry !== null && isFresh(entry, now)) kept.push(entry);
		else remove(storage, key);
	}
	const sorted = kept.sort((left, right) => right.savedAt - left.savedAt);
	for (const entry of sorted.slice(PACK_CACHE_SIZE)) {
		remove(storage, packKey(entry.packId));
	}
	return sorted.slice(0, PACK_CACHE_SIZE);
}

export function cachedPackText(
	packId: string,
	now: Date = new Date(),
): string | null {
	return (
		cachedPacks(now).find((entry) => entry.packId === packId)?.text ?? null
	);
}

export function rememberPack(
	packId: string,
	text: string,
	now: Date = new Date(),
): void {
	const storage = deviceStorage();
	if (storage === null || !PACK_KEY.test(packKey(packId))) return;
	try {
		storage.setItem(
			packKey(packId),
			JSON.stringify({ text, savedAt: now.getTime() }),
		);
	} catch {
		return;
	} finally {
		cachedPacks(now);
	}
}

export function forgetPacks(): void {
	const storage = deviceStorage();
	if (storage === null) return;
	for (const key of packKeys(storage)) remove(storage, key);
}

function ownerNoteKey(tenantId: string): string {
	return `${OWNER_NOTE_KEY_PREFIX}${tenantId}`;
}

export function rememberedOwnerNote(tenantId: string): string {
	const storage = deviceStorage();
	if (storage === null) return "";
	try {
		return storage.getItem(ownerNoteKey(tenantId)) ?? "";
	} catch {
		return "";
	}
}

export function rememberOwnerNote(tenantId: string, note: string): void {
	const storage = deviceStorage();
	if (storage === null) return;
	try {
		if (note.trim() === "") storage.removeItem(ownerNoteKey(tenantId));
		else storage.setItem(ownerNoteKey(tenantId), note);
	} catch {
		return;
	}
}
