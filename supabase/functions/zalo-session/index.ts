import { handleZaloSession } from "./handler.ts";

Deno.serve((request) => handleZaloSession(request, Deno.env.toObject()));
