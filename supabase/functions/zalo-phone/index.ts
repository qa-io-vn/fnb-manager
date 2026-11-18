import { handleZaloPhone } from "./handler.ts";

Deno.serve((request) => handleZaloPhone(request, Deno.env.toObject()));
