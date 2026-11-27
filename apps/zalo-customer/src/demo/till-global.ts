/**
 * Where the stand-in data exposes the demo till (the counter's side of the demo world) on the page, so a browser test
 * can act as staff: mark an order paid, start it, serve it, switch an item sold out. Only the demo world, which runs
 * with the stand-in data endpoint (browser mode), sets it; a build on a real endpoint never creates the demo world.
 */
export const DEMO_TILL_GLOBAL = "__FNB_DEMO_TILL__";
