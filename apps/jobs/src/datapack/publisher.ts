import type { PlanPublishInput } from "@fnb/datapack";
import { createClient } from "@supabase/supabase-js";
import type { SupabasePublisherSetting } from "../config/config.js";

export interface PublisherError {
	readonly code: string | null;
	readonly details: string | null;
	readonly message: string;
}

export interface PublisherAnswer {
	readonly planId: string | null;
	readonly alreadyPublished: boolean;
	readonly error: PublisherError | null;
}

export interface PublisherSession {
	signIn(email: string, password: string): Promise<boolean>;
	visibleMembers(): Promise<number | null>;
	publish(input: PlanPublishInput): Promise<PublisherAnswer>;
	signOut(): Promise<void>;
}

export type PublisherFactory = (url: string, key: string) => PublisherSession;

export const supabasePublisher: PublisherFactory = (url, key) => {
	const client = createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
	return {
		async signIn(email, password) {
			const { error } = await client.auth.signInWithPassword({
				email,
				password,
			});
			return error === null;
		},
		async visibleMembers() {
			const { count, error } = await client
				.from("tenant_members")
				.select("tenant_id", { count: "exact", head: true });
			return error ? null : (count ?? 0);
		},
		async publish(input) {
			const { data, error } = await client.rpc("publish_strategy_plan", {
				...input,
			});
			if (error) {
				return {
					planId: null,
					alreadyPublished: false,
					error: {
						code: error.code ?? null,
						details: error.details ?? null,
						message: error.message,
					},
				};
			}
			const row = (Array.isArray(data) ? data[0] : data) as
				| { plan_id?: string; already_published?: boolean }
				| undefined;
			return {
				planId: row?.plan_id ?? null,
				alreadyPublished: row?.already_published === true,
				error: null,
			};
		},
		async signOut() {
			await client.auth.signOut();
		},
	};
};

let factory: PublisherFactory = supabasePublisher;

export function publisherFactory(): PublisherFactory {
	return factory;
}

export function usePublisherFactory(next: PublisherFactory | null): void {
	factory = next ?? supabasePublisher;
}

export function openPublisher(
	setting: SupabasePublisherSetting,
): PublisherSession {
	return factory(setting.url, setting.publishableKey);
}

export function rejectionCodes(details: string | null): string[] {
	return (details ?? "")
		.split(",")
		.map((code) => code.trim())
		.filter((code) => code !== "");
}
