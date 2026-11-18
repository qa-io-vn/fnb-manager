import type { NativeStorage } from "../storage/native-storage";
import {
	MEMBER_ROLES,
	type MemberProfile,
	type MemberRole,
	type StoredSession,
} from "./types";

export const SESSION_STORAGE_KEY = "fnb.session";
export const SESSION_EXPIRY_SKEW_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMemberRole(value: unknown): value is MemberRole {
	return (
		typeof value === "string" &&
		(MEMBER_ROLES as readonly string[]).includes(value)
	);
}

function readMember(value: unknown): MemberProfile | null {
	if (!isRecord(value)) return null;
	const { displayName, role, stores } = value;
	if (typeof displayName !== "string" || displayName.trim() === "") return null;
	if (!isMemberRole(role)) return null;
	if (
		!Array.isArray(stores) ||
		!stores.every((store) => typeof store === "string")
	)
		return null;
	return { displayName, role, stores };
}

export function readStoredSession(value: unknown): StoredSession | null {
	if (!isRecord(value)) return null;
	const { accessToken, refreshToken, expiresAt } = value;
	if (typeof accessToken !== "string" || accessToken === "") return null;
	if (typeof refreshToken !== "string") return null;
	if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
	const member = readMember(value.member);
	if (!member) return null;
	return { accessToken, refreshToken, expiresAt, member };
}

export function isSessionFresh(
	session: StoredSession,
	nowMs: number,
	skewMs: number = SESSION_EXPIRY_SKEW_MS,
): boolean {
	return session.expiresAt * 1000 - skewMs > nowMs;
}

export interface SessionStore {
	read(): StoredSession | null;
	write(session: StoredSession): void;
	clear(): void;
}

export function createSessionStore(
	storage: NativeStorage,
	key: string = SESSION_STORAGE_KEY,
): SessionStore {
	return {
		read() {
			const raw = storage.getItem(key);
			if (raw === null) return null;
			try {
				const session = readStoredSession(JSON.parse(raw));
				if (session) return session;
			} catch {
				storage.removeItem(key);
				return null;
			}
			storage.removeItem(key);
			return null;
		},
		write(session) {
			storage.setItem(key, JSON.stringify(session));
		},
		clear() {
			storage.removeItem(key);
		},
	};
}

export function authorizationHeaders(
	session: StoredSession,
): Readonly<Record<"Authorization", string>> {
	return { Authorization: `Bearer ${session.accessToken}` };
}
