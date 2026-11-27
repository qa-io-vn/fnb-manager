import { handlePaymentsJob } from "./handler.ts";

Deno.serve((request) => handlePaymentsJob(request, Deno.env.toObject()));
