import "./zod-jitless";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("zod under the Content Security Policy", () => {
	it("runs jitless without loading zod first, so no eval probe trips script-src", () => {
		expect(z.config().jitless).toBe(true);
		expect(z.object({ a: z.number() }).parse({ a: 1 })).toEqual({ a: 1 });
	});
});
