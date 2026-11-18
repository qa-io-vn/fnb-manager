import { serveFunction } from "../_shared/http.ts";
import { webhookDatabase } from "../oa-webhook/database.ts";
import { runtimeWaitUntil } from "../oa-webhook/runtime.ts";
import { PostgresBotWebhookStore } from "./database.ts";
import { createBotWebhookHandler, FUNCTION_NAME } from "./handler.ts";

const handler = createBotWebhookHandler({
	store: (environment, context) =>
		new PostgresBotWebhookStore(
			webhookDatabase(environment, context, "fnb-bot-webhook"),
		),
	clock: () => new Date(),
	waitUntil: runtimeWaitUntil,
	fetch: (input, init) => fetch(input, init),
});

Deno.serve((request) =>
	serveFunction(request, Deno.env.toObject(), handler, {
		name: FUNCTION_NAME,
		origins: [],
	}),
);
