import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchAllPages, fetchOnce } from "../data/paginate";
import {
	type AuditEntry,
	auditAuthorOf,
	type MemberRoleRow,
	SettingsWriteError,
} from "./source";

export const numeric = z.union([z.number(), z.string()]).transform(Number);

export const nullableNumeric = z
	.union([z.number(), z.string()])
	.nullable()
	.transform((value) => (value === null ? null : Number(value)));

export const tenantRole = z.enum([
	"owner",
	"manager",
	"staff",
	"viewer",
	"publisher",
]);

const memberRoleRow = z.object({ user_id: z.string(), role: tenantRole });

export interface PostgrestFailure {
	readonly code?: string;
	readonly message?: string;
	readonly details?: string | null;
}

function constraintOf(error: PostgrestFailure): string | null {
	const text = `${error.message ?? ""} ${error.details ?? ""}`;
	return /constraint "([^"]+)"/.exec(text)?.[1] ?? null;
}

export function writeErrorOf(error: PostgrestFailure): SettingsWriteError {
	switch (error.code) {
		case "42501":
			return new SettingsWriteError("forbidden");
		case "23505":
			return new SettingsWriteError("duplicate", constraintOf(error));
		case "21000":
			return new SettingsWriteError("duplicate");
		case "23514":
		case "22023":
			return new SettingsWriteError("invalid", constraintOf(error));
		case "55000":
			return new SettingsWriteError("frozen");
		default:
			if (error.code === undefined || error.code === "") {
				return new SettingsWriteError("network");
			}
			return error.code.startsWith("PGRST3")
				? new SettingsWriteError("forbidden")
				: new SettingsWriteError("invalid");
	}
}

export async function written(
	request: PromiseLike<{ error: PostgrestFailure | null }>,
): Promise<void> {
	let result: { error: PostgrestFailure | null };
	try {
		result = await request;
	} catch {
		throw new SettingsWriteError("network");
	}
	if (result.error !== null) throw writeErrorOf(result.error);
}

export async function writtenRows<Row>(
	schema: z.ZodType<Row>,
	request: PromiseLike<{ data: unknown; error: PostgrestFailure | null }>,
): Promise<Row[]> {
	let result: { data: unknown; error: PostgrestFailure | null };
	try {
		result = await request;
	} catch {
		throw new SettingsWriteError("network");
	}
	if (result.error !== null) throw writeErrorOf(result.error);
	return z.array(schema).parse(result.data ?? []);
}

export function onlyRow<Row>(rows: readonly Row[]): Row {
	const [row] = rows;
	if (row === undefined) throw new SettingsWriteError("forbidden");
	return row;
}

export async function rereadOrNetwork<Row>(
	schema: z.ZodType<Row>,
	request: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<Row[]> {
	return fetchOnce(schema, request).catch(() => {
		throw new SettingsWriteError("network");
	});
}

export type AuditOf = (
	changedAt: string | null,
	updatedBy: string | null,
) => AuditEntry | null;

export interface SupabaseAudits {
	currentUserId(): Promise<string>;
	memberRoles(tenantId: string): Promise<MemberRoleRow[]>;
	auditsFor(tenantId: string): Promise<AuditOf>;
}

export function createSupabaseAudits(client: SupabaseClient): SupabaseAudits {
	const currentUserId = async (): Promise<string> => {
		const { data, error } = await client.auth.getUser();
		const userId = data.user?.id;
		if (error || userId === undefined) {
			throw new Error(error?.message ?? "not signed in");
		}
		return userId;
	};

	const memberRoles = async (tenantId: string): Promise<MemberRoleRow[]> => {
		const rows = await fetchAllPages(memberRoleRow, (from, to) =>
			client
				.from("tenant_members")
				.select("user_id,role")
				.eq("tenant_id", tenantId)
				.order("user_id")
				.range(from, to),
		);
		return rows.map((row) => ({ userId: row.user_id, role: row.role }));
	};

	return {
		currentUserId,
		memberRoles,
		async auditsFor(tenantId) {
			const [userId, members] = await Promise.all([
				currentUserId().catch(() => null),
				memberRoles(tenantId).catch((): MemberRoleRow[] => []),
			]);
			return (changedAt, updatedBy) =>
				changedAt === null
					? null
					: { changedAt, author: auditAuthorOf(updatedBy, userId, members) };
		},
	};
}

export async function deleteCleared(
	client: SupabaseClient,
	table: string,
	keyColumn: string,
	tenantId: string,
	clearedByAccount: ReadonlyMap<string, readonly string[]>,
): Promise<void> {
	const keyRow = z.object({ [keyColumn]: z.string() });
	for (const [posAccountId, keys] of clearedByAccount) {
		const removed = await writtenRows(
			keyRow,
			client
				.from(table)
				.delete()
				.eq("tenant_id", tenantId)
				.eq("pos_account_id", posAccountId)
				.in(keyColumn, [...keys])
				.select(keyColumn),
		);
		if (removed.length === keys.length) continue;
		const remaining = await rereadOrNetwork(
			keyRow,
			client
				.from(table)
				.select(keyColumn)
				.eq("tenant_id", tenantId)
				.eq("pos_account_id", posAccountId)
				.in(keyColumn, [...keys]),
		);
		if (remaining.length > 0) throw new SettingsWriteError("forbidden");
	}
}

export function clearedByAccount<
	Change extends { readonly posAccountId: string },
>(
	changes: readonly Change[],
	keyOf: (change: Change) => string,
	isCleared: (change: Change) => boolean,
): Map<string, string[]> {
	const byAccount = new Map<string, string[]>();
	for (const change of changes) {
		if (!isCleared(change)) continue;
		byAccount.set(change.posAccountId, [
			...(byAccount.get(change.posAccountId) ?? []),
			keyOf(change),
		]);
	}
	return byAccount;
}
