import { describe, expect, it } from "vitest";
import { parseSizeSuffix } from "../../src/index.js";

describe("parseSizeSuffix", () => {
	it.each([
		["Trà bưởi hồng (L)", "Trà bưởi hồng", "L"],
		["Phin nâu đá (M)", "Phin nâu đá", "M"],
		["Mãng Cầu Chanh Leo ( M )", "Mãng Cầu Chanh Leo", "M"],
		["Cà phê sữa (l)", "Cà phê sữa", "L"],
		["Trà đào (XL)", "Trà đào", "XL"],
		["Trà sữa (S)", "Trà sữa", "S"],
		["Trà sữa(M)", "Trà sữa", "M"],
		["Trà sữa (M) ", "Trà sữa", "M"],
	])("parses %j", (name, baseName, sizeLabel) => {
		expect(parseSizeSuffix(name)).toEqual({ baseName, sizeLabel });
	});

	it("leaves names without a size suffix unchanged", () => {
		expect(parseSizeSuffix("Matcha Latte")).toEqual({
			baseName: "Matcha Latte",
			sizeLabel: undefined,
		});
		expect(parseSizeSuffix("Bánh mì (nóng)")).toEqual({
			baseName: "Bánh mì (nóng)",
			sizeLabel: undefined,
		});
		expect(parseSizeSuffix("Combo (2) ly")).toEqual({
			baseName: "Combo (2) ly",
			sizeLabel: undefined,
		});
		expect(parseSizeSuffix("(M)")).toEqual({
			baseName: "(M)",
			sizeLabel: undefined,
		});
	});

	it("accepts a custom size vocabulary", () => {
		const sizes = ["nhỏ", "vừa", "lớn"];
		expect(parseSizeSuffix("Trà sữa (Lớn)", sizes)).toEqual({
			baseName: "Trà sữa",
			sizeLabel: "LỚN",
		});
		expect(parseSizeSuffix("Trà sữa (L)", sizes)).toEqual({
			baseName: "Trà sữa (L)",
			sizeLabel: undefined,
		});
	});

	it("accepts vocabulary labels longer than four characters", () => {
		const sizes = ["Small", "Large", "Extra Large"];
		expect(parseSizeSuffix("Trà sữa (Large)", sizes)).toEqual({
			baseName: "Trà sữa",
			sizeLabel: "LARGE",
		});
		expect(parseSizeSuffix("Trà sữa ( extra large )", sizes)).toEqual({
			baseName: "Trà sữa",
			sizeLabel: "EXTRA LARGE",
		});
		expect(parseSizeSuffix("Trà sữa ()", sizes)).toEqual({
			baseName: "Trà sữa ()",
			sizeLabel: undefined,
		});
	});
});
