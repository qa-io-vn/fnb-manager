import { describe, expect, it } from "vitest";
import { linkSearch } from "./later-page";

describe("the links of a theme of 10b", () => {
	it("keep the range and carry the stores chosen now, not those of the address", () => {
		expect(linkSearch("?range=364d&store=S1", ["S2"])).toBe(
			"range=364d&store=S2",
		);
		expect(linkSearch("?from=2026-10-08&to=2026-11-01", ["S1", "S2"])).toBe(
			"from=2026-10-08&to=2026-11-01&store=S1,S2",
		);
	});

	it("drop the stores when every store is chosen", () => {
		expect(linkSearch("?range=91d&store=S1", null)).toBe("range=91d");
		expect(linkSearch("", null)).toBe("");
	});
});
