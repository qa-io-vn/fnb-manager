import { handleBankWebhook } from "./handler.ts";

Deno.serve((request) => handleBankWebhook(request, Deno.env.toObject()));
