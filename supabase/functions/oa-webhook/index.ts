import { serveFunction } from "../_shared/http.ts";
import { webhookDatabase } from "./database.ts";
import {
	ACK_DEADLINE_MS,
	createOaWebhookHandler,
	FUNCTION_NAME,
} from "./handler.ts";
import { runtimeWaitUntil } from "./runtime.ts";
import { PostgresOaWebhookStore } from "./store.ts";

const handler = createOaWebhookHandler({
	store: (environment, context) =>
		new PostgresOaWebhookStore(
			webhookDatabase(environment, context, "fnb-oa-webhook"),
		),
	clock: () => new Date(),
	waitUntil: runtimeWaitUntil,
	ackDeadlineMs: ACK_DEADLINE_MS,
});

Deno.serve((request) =>
	serveFunction(request, Deno.env.toObject(), handler, {
		name: FUNCTION_NAME,
		origins: [],
	}),
);
