import {
	type AnalyticsSource,
	createRpcAnalyticsSource,
	type RpcClient,
} from "@fnb/reports";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseAnalyticsSource(
	client: SupabaseClient,
): AnalyticsSource {
	const rpc: RpcClient = {
		rpc: (fn, args) => client.rpc(fn, args),
	};
	return createRpcAnalyticsSource(rpc, "supabase");
}
