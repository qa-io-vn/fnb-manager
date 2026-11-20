import {
	I18nProvider,
	PRELOAD_DELAY_MS,
	preloadLazyScreens,
} from "@fnb/zalo-mini/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { catalogs } from "./i18n/catalog";
import { lazyCard, lazyScreen } from "./lazy";

function Hello({ name }: { readonly name: string }) {
	return <p data-testid="hello">Xin chào {name}</p>;
}

function shown(node: React.ReactNode) {
	return render(
		<I18nProvider language="vi" catalogs={catalogs}>
			{node}
		</I18nProvider>,
	);
}

describe("lazyScreen", () => {
	it("shows a loading status, then the screen with its props, and fetches the chunk once", async () => {
		const importer = vi.fn(async () => ({ Hello }));
		const Screen = lazyScreen(importer, (m) => m.Hello);
		const first = shown(<Screen name="A" />);
		expect(screen.getByTestId("screen-loading")).toBeInTheDocument();
		expect(await screen.findByTestId("hello")).toHaveTextContent("Xin chào A");
		first.unmount();
		shown(<Screen name="B" />);
		expect(screen.getByTestId("hello")).toHaveTextContent("Xin chào B");
		expect(screen.queryByTestId("screen-loading")).not.toBeInTheDocument();
		expect(importer).toHaveBeenCalledTimes(1);
	});

	it("says the chunk is missing without leaking the error, and a retry loads it", async () => {
		let online = false;
		const importer = vi.fn(async () => {
			if (!online)
				throw new Error("Failed to fetch dynamically imported module");
			return { Hello };
		});
		const Screen = lazyScreen(importer, (m) => m.Hello);
		shown(<Screen name="A" />);
		const failed = await screen.findByTestId("screen-load-failed");
		expect(failed).toHaveTextContent("Thử lại");
		expect(failed.textContent).not.toContain("Failed to fetch");
		online = true;
		fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
		expect(await screen.findByTestId("hello")).toBeInTheDocument();
		expect(screen.queryByTestId("screen-load-failed")).not.toBeInTheDocument();
		expect(importer).toHaveBeenCalledTimes(2);
	});
});

describe("lazyCard", () => {
	it("shows nothing until its chunk arrives, then the card", async () => {
		const Card = lazyCard(
			async () => ({ Hello }),
			(m) => m.Hello,
		);
		const view = shown(<Card name="A" />);
		expect(view.container).toBeEmptyDOMElement();
		expect(await screen.findByTestId("hello")).toBeInTheDocument();
	});

	it("stays empty, without an alert, when its chunk cannot be fetched", async () => {
		const importer = vi.fn(async () => {
			throw new Error("offline");
		});
		const Card = lazyCard(importer, (m: { Hello: typeof Hello }) => m.Hello);
		const view = shown(<Card name="A" />);
		await vi.waitFor(() => expect(importer).toHaveBeenCalled());
		expect(view.container).toBeEmptyDOMElement();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});
});

describe("preloadLazyScreens", () => {
	it("fetches every screen's chunk after the load and an idle moment, and forgives a failed fetch", async () => {
		vi.useFakeTimers();
		try {
			const present = vi.fn(async () => ({ Hello }));
			const missing = vi.fn(async () => {
				throw new Error("offline");
			});
			lazyScreen(present, (m) => m.Hello);
			lazyScreen(missing, (m: { Hello: typeof Hello }) => m.Hello);
			preloadLazyScreens();
			expect(present).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(PRELOAD_DELAY_MS + 1);
			await vi.advanceTimersByTimeAsync(2000);
			expect(present).toHaveBeenCalledTimes(1);
			expect(missing).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
