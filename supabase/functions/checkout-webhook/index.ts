import { handleCheckoutWebhook } from "./handler.ts";

function connectionHost(address: Deno.Addr): string | null {
	return "hostname" in address ? address.hostname : null;
}

Deno.serve((request, info) =>
	handleCheckoutWebhook(request, Deno.env.toObject(), {
		connectionAddress: () => connectionHost(info.remoteAddr),
	}),
);
