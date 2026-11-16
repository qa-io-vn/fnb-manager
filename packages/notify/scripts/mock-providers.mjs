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
	`mock providers listening on 127.0.0.1:${mock.port}; set ${Object.keys(mock.environment()).join(", ")} to ${mock.baseUrl}`,
);
const stop = async () => {
	console.log(
		`mock providers: requests ${mock.requestCount()}, Zalo messages ${mock.zaloMessages().length}, Telegram messages ${mock.telegramMessages().length}, e-mails ${mock.emails().length}, webhook deliveries ${mock.webhookDeliveries().length}`,
	);
	await mock.close();
	process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
