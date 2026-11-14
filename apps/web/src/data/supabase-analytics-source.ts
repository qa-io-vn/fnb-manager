import {
	createRpcReportSource,
	type ReportSource,
	type RpcClient,
} from "@fnb/reports";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseAnalyticsSource(
	client: SupabaseClient,
): ReportSource {
	const rpc: RpcClient = {
		rpc: (fn, args) => client.rpc(fn, args),
	};
	return createRpcReportSource(rpc, "supabase");
}
