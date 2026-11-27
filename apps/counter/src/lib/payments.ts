import {
	createPaymentClient,
	type PaymentClient,
} from "@fnb/zalo-mini/ordering";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CounterEnvironment } from "../env";

/**
 * The online payment function (checkout-order) with the staff member's session, read at each call so a refreshed
 * token is the one sent. The counter only opens a VietQR for a counter order; whether it was paid is read from the
 * order (counter_order), never from the function.
 */
export function counterPaymentClient(
	environment: CounterEnvironment,
	client: SupabaseClient,
): PaymentClient {
	return createPaymentClient({
		url: environment.supabaseUrl,
		endpoint: environment.checkoutUrl,
		publishableKey: environment.publishableKey,
		accessToken: async () =>
			(await client.auth.getSession()).data.session?.access_token ?? null,
	});
}
