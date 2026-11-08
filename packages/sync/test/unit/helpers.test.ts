import { describe, expect, it } from "vitest";
import {
	createRedactor,
	formatMoney,
	formatQuantity,
	invoiceDigest,
	storeLockKey,
} from "../../src/index.js";

describe("storeLockKey", () => {
	it("is a stable signed 64-bit key per store", () => {
		const key = storeLockKey("22222222-2222-4222-8222-000000000001");
		expect(key).toBe(storeLockKey("22222222-2222-4222-8222-000000000001"));
		expect(key).not.toBe(storeLockKey("22222222-2222-4222-8222-000000000002"));
		const value = BigInt(key);
		expect(value >= -(2n ** 63n) && value < 2n ** 63n).toBe(true);
	});
});

describe("numeric formatting", () => {
	it("rounds half away from zero to the column scale", () => {
		expect(formatMoney(1.005)).toBe("1.01");
		expect(formatMoney(-0.001)).toBe("0.00");
		expect(formatMoney(45000)).toBe("45000.00");
		expect(formatQuantity(0.3333)).toBe("0.333");
		expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
	});
});

describe("redactor", () => {
	it("removes literal secrets, connection passwords, keys and tokens", () => {
		const redact = createRedactor(["s3cret-pass"]);
		expect(redact("login failed for s3cret-pass")).toBe("login failed for ***");
		expect(redact("postgresql://postgres.ref:pw@pooler:5432/postgres")).toBe(
			"postgresql://***@pooler:5432/postgres",
		);
		expect(redact("key 0123456789abcdef0123456789abcdef used")).toBe(
			"key *** used",
		);
		expect(redact("password=abc&user=x")).toBe("password=***&user=x");
		expect(
			redact("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig"),
		).toBe("Bearer ***");
	});
});

describe("invoiceDigest", () => {
	it("ignores line and payment order", () => {
		const invoice = { external_id: "T-1" } as Parameters<
			typeof invoiceDigest
		>[0];
		const lineA = { external_id: "A", quantity: "1.000" } as Parameters<
			typeof invoiceDigest
		>[1][number];
		const lineB = { external_id: "B", quantity: "2.000" } as Parameters<
			typeof invoiceDigest
		>[1][number];
		expect(invoiceDigest(invoice, [lineA, lineB], [])).toBe(
			invoiceDigest(invoice, [lineB, lineA], []),
		);
		expect(invoiceDigest(invoice, [lineA], [])).not.toBe(
			invoiceDigest(invoice, [lineB], []),
		);
	});
});
