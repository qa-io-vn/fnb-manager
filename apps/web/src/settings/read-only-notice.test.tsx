import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithLanguage } from "../test/render";
import { ReadOnlyNotice } from "./read-only-notice";

describe("ReadOnlyNotice", () => {
	it("says in plain words why a member can only read", () => {
		renderWithLanguage(
			<ReadOnlyNotice access={{ canWrite: false, reason: "ownerOnly" }} />,
		);
		expect(screen.getByTestId("settings-read-only")).toHaveTextContent(
			"chỉ chủ xem được tất cả cửa hàng",
		);
	});

	it("shows nothing to a member who may write", () => {
		const { container } = renderWithLanguage(
			<ReadOnlyNotice access={{ canWrite: true, reason: null }} />,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
