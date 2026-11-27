import { handleCounterSession } from "./handler.ts";

Deno.serve((request) => handleCounterSession(request, Deno.env.toObject()));
