#!/usr/bin/env node
import { parseArgs } from "node:util";
import { register } from "tsx/esm/api";

register();
const { values } = parseArgs({
	options: { port: { type: "string", default: "8787" } },
	strict: true,
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 10 || port > 65535) {
	console.error("--port must be a TCP port number");
	process.exit(2);
}
const { startMockProviders } = await import(
	new URL("../src/testing/mock-providers.ts", import.meta.url).href
);
const mock = await startMockProviders({ port, acceptAnyToken: true });
console.log(
	`mock providers listening on 127.0.0.1:${mock.port}; set NOTIFY_ZALO_BOT_BASE_URL and NOTIFY_BREVO_BASE_URL to ${mock.baseUrl}`,
);
const stop = async () => {
	console.log(
		`mock providers: requests ${mock.requestCount()}, messages accepted ${mock.zaloMessages().length}, e-mails accepted ${mock.emails().length}`,
	);
	await mock.close();
	process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
