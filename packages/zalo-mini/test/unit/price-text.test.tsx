import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { looksLikePrice } from "../../src/format/index";
import type { Language } from "../../src/i18n/translate";
import { I18nProvider } from "../../src/react/i18n";
import { sharedCatalogs } from "../../src/react/index";
import { PriceText } from "../../src/react/ui-kit/price-text";

// Test design (ISTQB): equivalence partitions of the component (a price, a positive, a negative and a zero change, and
// each size and tone), a boundary at 0 and at the largest whole number, both languages for the spoken text, the
// decision table of the sign (price or delta, positive, zero or negative -> written text and spoken text), and the rule
// that a price is only ever inside an element marked data-price. Security: an amount that is not a number is refused
// before anything is drawn, so no text can reach the page through a price.

function priceText(
	props: Parameters<typeof PriceText>[0],
	language: Language = "vi",
) {
	return render(
		<I18nProvider language={language} catalogs={sharedCatalogs}>
			<p data-testid="line">
				<PriceText {...props} />
			</p>
		</I18nProvider>,
	);
}

function marked(container: HTMLElement): HTMLElement {
	const found = container.querySelector<HTMLElement>("[data-price]");
	if (found === null) throw new Error("no element is marked data-price");
	return found;
}

describe("PriceText", () => {
	it("marks the price with data-price (the amount in đồng), shows it written and gives a screen reader the spoken text", () => {
		const { container } = priceText({ amount: 35000 });
		const price = marked(container);
		expect(price.getAttribute("data-price")).toBe("35000");
		const [visible, spoken] = [...price.children] as HTMLElement[];
		expect(visible?.textContent).toBe("35.000đ");
		expect(visible?.getAttribute("aria-hidden")).toBe("true");
		expect(spoken?.textContent).toBe("35.000 đồng");
		expect(spoken?.className).toContain("sr-only");
		expect(spoken?.getAttribute("aria-hidden")).toBeNull();
	});

	it("keeps every text that looks like a price inside the marked element", () => {
		for (const props of [
			{ amount: 0 },
			{ amount: 1 },
			{ amount: 999 },
			{ amount: 35000 },
			{ amount: 1234567 },
			{ amount: Number.MAX_SAFE_INTEGER },
			{ amount: 5000, kind: "delta" as const },
			{ amount: -5000, kind: "delta" as const },
		]) {
			const { container, unmount } = priceText(props);
			const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
			let seen = 0;
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (!looksLikePrice(node.textContent ?? "")) continue;
				seen += 1;
				expect(
					node.parentElement?.closest("[data-price]"),
					node.textContent ?? "",
				).not.toBeNull();
			}
			expect(seen, JSON.stringify(props)).toBe(2);
			unmount();
		}
	});

	// decision table: kind x sign of the amount -> the written and the spoken text
	it.each([
		["price", 0, "0đ", "0 đồng", "0 dong"],
		["price", 35000, "35.000đ", "35.000 đồng", "35.000 dong"],
		["delta", 5000, "+5.000đ", "cộng 5.000 đồng", "plus 5.000 dong"],
		["delta", 0, "0đ", "0 đồng", "0 dong"],
		["delta", -5000, "−5.000đ", "trừ 5.000 đồng", "minus 5.000 dong"],
	] as const)(
		"a %s of %i is written %s and spoken %s (English: %s)",
		(kind, amount, written, spokenVi, spokenEn) => {
			const vi = priceText({ amount, kind });
			expect(marked(vi.container).children[0]?.textContent).toBe(written);
			expect(marked(vi.container).children[1]?.textContent).toBe(spokenVi);
			vi.unmount();
			const en = priceText({ amount, kind }, "en");
			expect(marked(en.container).children[0]?.textContent).toBe(written);
			expect(marked(en.container).children[1]?.textContent).toBe(spokenEn);
		},
	);

	it("writes the size and the tone of the design spec", () => {
		const list = marked(priceText({ amount: 35000, size: "list" }).container);
		expect(list.className).toContain("text-[15px]");
		expect(list.className).toContain("font-bold");
		// the brand's price colour, the accent when the brand sets none
		expect(list.style.color).toBe("var(--brand-highlight, var(--accent))");
	});

	it("has a lead size for an item price and a total, and a note size and a muted tone for a delta", () => {
		const lead = marked(
			priceText({ amount: 39000, size: "lead", tone: "ink" }).container,
		);
		expect(lead.className).toContain("text-[19px]");
		expect(lead.className).toContain("text-ink");
		expect(lead.style.color).toBe("");
		const note = marked(
			priceText({ amount: 5000, kind: "delta", size: "note", tone: "muted" })
				.container,
		);
		expect(note.className).toContain("text-[13px]");
		expect(note.className).toContain("font-semibold");
		expect(note.className).toContain("text-ink-muted");
	});

	it("takes the size around it when it has none, and adds a class of the caller", () => {
		const plain = marked(priceText({ amount: 1000, tone: "ink" }).container);
		expect(plain.className).toBe("text-ink");
		const extra = marked(
			priceText({ amount: 1000, tone: "ink", className: "ml-2" }).container,
		);
		expect(extra.className).toBe("text-ink ml-2");
	});

	it("passes a test id to the marked element", () => {
		const price = marked(
			priceText({ amount: 1000, testId: "menu-item-price" }).container,
		);
		expect(price.getAttribute("data-testid")).toBe("menu-item-price");
	});

	it("refuses an amount that is not a whole number, or not a number, before drawing anything", () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		try {
			for (const bad of [
				-1,
				0.5,
				Number.NaN,
				"35000",
				"<img src=x onerror=alert(1)>",
				null,
			]) {
				expect(() => priceText({ amount: bad as never }), String(bad)).toThrow(
					RangeError,
				);
			}
			expect(document.body.querySelector("img")).toBeNull();
			expect(document.querySelector("[data-price]")).toBeNull();
		} finally {
			error.mockRestore();
		}
	});
});
