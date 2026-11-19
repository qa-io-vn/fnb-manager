import { serveFunction } from "../_shared/http.ts";
import { webhookDatabase } from "../oa-webhook/database.ts";
import { PostgresVoucherCallbackStore } from "./database.ts";
import { createVoucherCallbackHandler, FUNCTION_NAME } from "./handler.ts";

const handler = createVoucherCallbackHandler({
	store: (environment, context) =>
		new PostgresVoucherCallbackStore(
			webhookDatabase(environment, context, "fnb-voucher-callback"),
		),
	clock: () => new Date(),
});

Deno.serve((request) =>
	serveFunction(request, Deno.env.toObject(), handler, {
		name: FUNCTION_NAME,
		origins: [],
	}),
);
