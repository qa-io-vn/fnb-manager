import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Button, buttonVariants } from "./button";
import { fieldVariants, TextField } from "./field";
import { TextLink } from "./text-link";

function classSet(classes: string): string[] {
	return classes.split(/\s+/).filter(Boolean).sort();
}

describe("shared controls", () => {
	it("draw the primary button with the classes the screens used before", () => {
		expect(classSet(buttonVariants())).toEqual(
			classSet(
				"min-h-11 rounded-lg bg-accent px-4 font-semibold text-accent-ink",
			),
		);
	});

	it("draw the compact secondary and warning buttons with their former classes", () => {
		expect(
			classSet(buttonVariants({ tone: "secondary", size: "compact" })),
		).toEqual(
			classSet(
				"min-h-11 rounded-lg border border-line px-3 text-sm font-medium hover:bg-surface-sunken",
			),
		);
		expect(
			classSet(buttonVariants({ tone: "warning", size: "compact" })),
		).toEqual(
			classSet(
				"min-h-11 rounded-lg border border-warning bg-warning-soft px-3 text-sm font-medium",
			),
		);
	});

	it("let a screen override a variant's class without keeping both", () => {
		render(<Button className="rounded-full px-5 shadow-lg">Tải lại</Button>);
		const button = screen.getByRole("button", { name: "Tải lại" });
		expect(classSet(button.className)).toEqual(
			classSet(
				"min-h-11 rounded-full bg-accent px-5 font-semibold text-accent-ink shadow-lg",
			),
		);
		expect(button).toHaveAttribute("type", "button");
	});

	it("give inputs, selects and field-like triggers one field style", () => {
		expect(classSet(fieldVariants())).toEqual(
			classSet(
				"min-h-11 rounded-lg border border-line bg-surface-raised px-2 text-sm",
			),
		);
		expect(classSet(fieldVariants({ kind: "trigger" }))).toEqual(
			classSet(
				"inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 text-sm",
			),
		);
	});

	it("label a text field and let password managers fill it", () => {
		render(
			<TextField
				id="password"
				label="Mật khẩu"
				type="password"
				value=""
				onChange={() => undefined}
				autoComplete="current-password"
			/>,
		);
		const field = screen.getByLabelText("Mật khẩu");
		expect(field).toHaveAttribute("autocomplete", "current-password");
		expect(field).toBeRequired();
	});

	it("underline text links", () => {
		render(
			<MemoryRouter>
				<TextLink to="/quen-mat-khau">Quên mật khẩu?</TextLink>
			</MemoryRouter>,
		);
		expect(screen.getByRole("link", { name: "Quên mật khẩu?" })).toHaveClass(
			"underline",
			"text-accent",
		);
	});
});
