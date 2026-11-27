import { handleWebRequests } from "./handler.ts";

Deno.serve((request) => handleWebRequests(request, Deno.env.toObject()));
