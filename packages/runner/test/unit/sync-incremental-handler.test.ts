import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

type Handler = (
	request: Request,
	environment: Readonly<Record<string, string | undefined>>,
) => Promise<Response>;

const HANDLER = fileURLToPath(
	new URL(
		"../../../../supabase/functions/sync-incremental/handler.ts",
		import.meta.url,
	),
);
const { handleRequest } = (await import(/* @vite-ignore */ HANDLER)) as {
	handleRequest: Handler;
};

const TICKET = "00000000-0000-4000-8000-0000000f0001";
const ENVIRONMENT = {
	FNB_DB_URL: "postgresql://postgres:postgres@127.0.0.1:1/postgres",
	POS_ACCOUNTS_JSON: JSON.stringify([
		{
			key: "shop",
			connector: "ipos-fabi",
			email: "owner@example.com",
			password: "never-sent",
		},
	]),
};

function ticketRequest(): Request {
	return new Request("http://localhost/sync-incremental", {
		method: "POST",
		body: JSON.stringify({ ticket: TICKET, wait: true }),
	});
}

function logged(spy: { mock: { calls: unknown[][] } }): string[] {
	return spy.mock.calls.map((call) => String(call[0]));
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("sync-incremental Edge Function and IPOS_REAL_API", () => {
	it("refuses off before it claims the ticket, since it keeps no snapshot", async () => {
		const network = vi.spyOn(globalThis, "fetch");
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const response = await handleRequest(ticketRequest(), {
			...ENVIRONMENT,
			IPOS_REAL_API: "off",
		});
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: "the function is not configured",
		});
		expect(logged(log).join("\n")).toContain(
			"IPOS_REAL_API=off: the Edge Function keeps no iPOS snapshot",
		);
		expect(network).not.toHaveBeenCalled();
	});

	it("refuses a value that is neither on nor off", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const response = await handleRequest(ticketRequest(), {
			...ENVIRONMENT,
			IPOS_REAL_API: "yes",
		});
		expect(response.status).toBe(500);
		expect(logged(log).join("\n")).toContain("IPOS_REAL_API must be on or off");
	});

	it("names the real API and goes on to claim the ticket when on or unset", async () => {
		const network = vi.spyOn(globalThis, "fetch");
		for (const environment of [
			ENVIRONMENT,
			{ ...ENVIRONMENT, IPOS_REAL_API: "on" },
		]) {
			const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
			const response = await handleRequest(ticketRequest(), environment);
			expect(response.status).toBe(503);
			expect(logged(log)).toContain(
				"sync-incremental: iPOS: REAL API (posapi.ipos.vn)",
			);
			log.mockRestore();
		}
		expect(network).not.toHaveBeenCalled();
	});
});
