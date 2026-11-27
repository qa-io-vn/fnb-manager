import { handleEInvoiceJob } from "./handler.ts";

Deno.serve((request) => handleEInvoiceJob(request, Deno.env.toObject()));
