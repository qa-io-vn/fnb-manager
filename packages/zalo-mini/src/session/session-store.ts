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

function isTextList(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
}

function readMember(value: unknown): MemberProfile | null {
	if (!isRecord(value)) return null;
	const { displayName, role, stores, storeIds, tenantId } = value;
	if (typeof displayName !== "string" || displayName.trim() === "") return null;
	if (!isMemberRole(role)) return null;
	if (!isTextList(stores)) return null;
	if (
		storeIds !== undefined &&
		(!isTextList(storeIds) || storeIds.some((id) => id === ""))
	)
		return null;
	const withIds = storeIds === undefined ? {} : { storeIds };
	if (tenantId === undefined) return { displayName, role, stores, ...withIds };
	if (typeof tenantId !== "string" || tenantId === "") return null;
	return { displayName, role, stores, ...withIds, tenantId };
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
