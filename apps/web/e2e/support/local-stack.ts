import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const seedPath = fileURLToPath(
	new URL("../../../../supabase/seed.sql", import.meta.url),
);
const env = loadEnv("development", appRoot, "VITE_");

export const localStack = {
	url: env.VITE_SUPABASE_URL ?? "",
	publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
	mailCatcherUrl: "http://127.0.0.1:54324",
};

export const isLocalStackConfigured =
	localStack.url !== "" && localStack.publishableKey !== "";

function seedConstant(name: string): string {
	const seed = readFileSync(seedPath, "utf8");
	const match = seed.match(new RegExp(`'([^']+)'::text as ${name}`));
	if (!match?.[1]) throw new Error(`seed constant ${name} not found`);
	return match[1];
}

export const seededLogin = {
	email: seedConstant("dev_user_email"),
	password: seedConstant("dev_user_password"),
};

export function anonymousClient(): SupabaseClient {
	return createClient(localStack.url, localStack.publishableKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

export async function signedInClient(): Promise<SupabaseClient> {
	const client = anonymousClient();
	const { error } = await client.auth.signInWithPassword(seededLogin);
	if (error) throw error;
	return client;
}

export function localDate(
	timeZone: string,
	instant: Date,
	dayOffset = 0,
): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(instant);
	const date = new Date(`${parts}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + dayOffset);
	return date.toISOString().slice(0, 10);
}

export interface DayTotals {
	net: number;
	invoices: number;
}

const ORACLE_PAGE_SIZE = 1_000;

export async function expectedDayTotals(
	client: SupabaseClient,
	storeIds: readonly string[],
	businessDate: string,
): Promise<DayTotals> {
	const amounts: number[] = [];
	for (let from = 0; ; from += ORACLE_PAGE_SIZE) {
		const { data, error } = await client
			.from("invoices")
			.select("net_amount")
			.in("store_id", [...storeIds])
			.eq("business_date", businessDate)
			.neq("status", "voided")
			.order("id")
			.range(from, from + ORACLE_PAGE_SIZE - 1);
		if (error) throw error;
		const rows = data as { net_amount: number | string }[];
		amounts.push(...rows.map((row) => Number(row.net_amount)));
		if (rows.length < ORACLE_PAGE_SIZE) break;
	}
	return {
		net: amounts.reduce((total, amount) => total + amount, 0),
		invoices: amounts.length,
	};
}

export async function newestSeededDate(
	client: SupabaseClient,
): Promise<string> {
	const { data, error } = await client
		.from("invoices")
		.select("business_date")
		.order("business_date", { ascending: false })
		.limit(1);
	if (error) throw error;
	const newest = (data as { business_date: string }[])[0]?.business_date;
	if (!newest) throw new Error("the local database has no seeded invoices");
	return newest;
}

function shiftDate(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function middayIn(timeZone: string, isoDate: string): Date {
	const guess = new Date(`${isoDate}T12:00:00Z`);
	const wallClock = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	})
		.format(guess)
		.replace(", ", "T");
	const offset = new Date(`${wallClock}:00Z`).getTime() - guess.getTime();
	return new Date(guess.getTime() - offset);
}

export interface SeededClock {
	now: Date;
	today: string;
	yesterday: string;
}

export function clockAfterSeed(
	newestDate: string,
	timeZone: string,
	realNow: Date = new Date(),
): SeededClock {
	const today = shiftDate(newestDate, 1);
	const now =
		localDate(timeZone, realNow) === today
			? realNow
			: middayIn(timeZone, today);
	return { now, today, yesterday: newestDate };
}

export async function matchedStoreIds(
	client: SupabaseClient,
	businessDate: string,
): Promise<Set<string>> {
	const { data, error } = await client
		.from("sync_checks")
		.select("store_id,is_matched")
		.eq("business_date", businessDate);
	if (error) throw error;
	return new Set(
		(data as { store_id: string; is_matched: boolean }[])
			.filter((row) => row.is_matched)
			.map((row) => row.store_id),
	);
}

export async function visibleStores(
	client: SupabaseClient,
): Promise<{ id: string; name: string; timezone: string }[]> {
	const { data, error } = await client
		.from("stores")
		.select("id,name,timezone")
		.order("name");
	if (error) throw error;
	return data as { id: string; name: string; timezone: string }[];
}
