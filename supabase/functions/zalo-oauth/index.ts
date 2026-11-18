import { serveFunction } from "../_shared/http.ts";
import { oauthDatabase, PostgresZaloOauthDatabase } from "./database.ts";
import { createZaloOauthHandler, FUNCTION_NAME } from "./handler.ts";

const handler = createZaloOauthHandler({
	database: (environment, context) =>
		new PostgresZaloOauthDatabase(oauthDatabase(environment, context)),
	clock: () => new Date(),
});

Deno.serve((request) =>
	serveFunction(request, Deno.env.toObject(), handler, {
		name: FUNCTION_NAME,
		origins: [],
	}),
);
