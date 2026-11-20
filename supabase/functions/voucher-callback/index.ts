import { serveFunction } from "../_shared/http.ts";
import { webhookDatabase } from "../oa-webhook/database.ts";
import { PostgresVoucherCallbackStore } from "./database.ts";
import { createVoucherCallbackHandler, FUNCTION_NAME } from "./handler.ts";

function connectionHost(address: Deno.Addr): string | null {
	return "hostname" in address ? address.hostname : null;
}

Deno.serve((request, info) =>
	serveFunction(
		request,
		Deno.env.toObject(),
		createVoucherCallbackHandler({
			store: (environment, context) =>
				new PostgresVoucherCallbackStore(
					webhookDatabase(environment, context, "fnb-voucher-callback"),
				),
			clock: () => new Date(),
			connectionAddress: () => connectionHost(info.remoteAddr),
		}),
		{
			name: FUNCTION_NAME,
			origins: [],
		},
	),
);
