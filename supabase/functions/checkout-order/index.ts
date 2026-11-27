import { handleCheckoutOrder } from "./handler.ts";

Deno.serve((request) => handleCheckoutOrder(request, Deno.env.toObject()));
