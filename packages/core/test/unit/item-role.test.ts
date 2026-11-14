import { describe, expect, it } from "vitest";
import { classifyModifier, suggestRole } from "../../src/index.js";

describe("suggestRole", () => {
	it.each([
		["Trà sữa", "drink"],
		["TRÀ TRÁI CÂY", "drink"],
		["Cà phê", "drink"],
		["Cafe máy", "drink"],
		["Coffee", "drink"],
		["Sữa chua", "drink"],
		["Nước ép", "drink"],
		["Sinh tố", "drink"],
		["Đá xay", "drink"],
		["Soda Ý", "drink"],
		["Matcha Latte", "drink"],
		["Cacao nóng", "drink"],
		["Topping", "topping"],
		["Trân châu", "topping"],
		["Thạch", "topping"],
		["Pudding trứng", "topping"],
		["Kem cheese", "topping"],
		["Kem muối", "topping"],
		["Hướng dương", "snack"],
		["Hạt dưa", "snack"],
		["Snack", "snack"],
		["Bánh ngọt", "snack"],
		["Khô gà", "snack"],
		["Cơm trưa", "food"],
		["Mì cay", "food"],
		["Bún bò", "food"],
		["Phở", "food"],
		["Xôi", "food"],
		["Bánh mì", "food"],
	])("suggests %j as %s", (name, role) => {
		expect(suggestRole(name)).toBe(role);
	});

	it("takes the role of the earliest term, so a drink with a topping in its name stays a drink", () => {
		expect(suggestRole("Trà sữa trân châu")).toBe("drink");
		expect(suggestRole("Topping trà sữa")).toBe("topping");
	});

	it("prefers the longer term at the same position, so bánh mì is food and not a snack", () => {
		expect(suggestRole("Bánh mì que")).toBe("food");
		expect(suggestRole("Bánh flan")).toBe("snack");
	});

	it("matches short terms as whole words only", () => {
		expect(suggestRole("Mì")).toBe("food");
		expect(suggestRole("Mìn")).toBeNull();
		expect(suggestRole("Hạt")).toBe("snack");
		expect(suggestRole("Hạtxx")).toBeNull();
		expect(suggestRole("Trà")).toBe("drink");
		expect(suggestRole("Tràng")).toBeNull();
	});

	it("reads decomposed Vietnamese the same as composed text", () => {
		expect(suggestRole("Trà sữa")).toBe("drink");
	});

	it.each(["Combo", "Khác", "Phụ thu", "", "   "])(
		"suggests nothing for %j",
		(name) => {
			expect(suggestRole(name)).toBeNull();
		},
	);
});

describe("classifyModifier", () => {
	it.each([
		["Ít đường", "sugar"],
		["70% đường", "sugar"],
		["Không ngọt", "sugar"],
		["Less sugar", "sugar"],
		["Ít đá", "ice"],
		["Không đá", "ice"],
		["Đá riêng", "ice"],
		["No ice", "ice"],
		["Thêm trân châu", "other"],
		["Size L", "other"],
		["Juice", "other"],
		["Rice", "other"],
		["Đánh bông", "other"],
		["", "other"],
	])("classifies %j as %s", (name, family) => {
		expect(classifyModifier(name)).toBe(family);
	});
});
