import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	SettingsSourceProvider,
	useRetrySettingsSource,
	useSettingsSourceState,
} from "./settings-source-context";

const loading = vi.hoisted(() => ({ failures: 0, loads: 0 }));

vi.mock("../app-mode/app-mode", () => ({
	useAppMode: () => ({ mode: "demo" }),
}));

vi.mock("../auth/session", () => ({
	useSession: () => ({ client: null, clientFailed: false }),
}));

vi.mock("../demo/demo-settings", () => ({
	sharedDemoSettings: () => ({}),
}));

vi.mock("./demo-settings-source", () => ({
	createDemoSettingsSource: () => {
		loading.loads += 1;
		if (loading.failures > 0) {
			loading.failures -= 1;
			throw new Error("chunk failed to load");
		}
		return { kind: "demo" };
	},
}));

function Page({ name }: { name: string }) {
	const state = useSettingsSourceState();
	const retry = useRetrySettingsSource();
	return (
		<div>
			<output data-testid={name}>{state.status}</output>
			<button type="button" onClick={retry}>
				retry
			</button>
		</div>
	);
}

function App({ page }: { page: "first" | "second" | "none" }) {
	return (
		<SettingsSourceProvider>
			{page === "none" ? null : <Page key={page} name={page} />}
		</SettingsSourceProvider>
	);
}

describe("SettingsSourceProvider", () => {
	beforeEach(() => {
		loading.failures = 0;
		loading.loads = 0;
	});

	it("loads nothing until a page asks for the source", async () => {
		const { rerender } = render(<App page="none" />);
		expect(loading.loads).toBe(0);
		rerender(<App page="first" />);
		await waitFor(() =>
			expect(screen.getByTestId("first")).toHaveTextContent("ready"),
		);
		expect(loading.loads).toBe(1);
	});

	it("tries again when the next page asks after a failed load", async () => {
		loading.failures = 1;
		const { rerender } = render(<App page="first" />);
		await waitFor(() =>
			expect(screen.getByTestId("first")).toHaveTextContent("failed"),
		);
		rerender(<App page="second" />);
		await waitFor(() =>
			expect(screen.getByTestId("second")).toHaveTextContent("ready"),
		);
		expect(loading.loads).toBe(2);
	});

	it("does not reload a source that loaded", async () => {
		const { rerender } = render(<App page="first" />);
		await waitFor(() =>
			expect(screen.getByTestId("first")).toHaveTextContent("ready"),
		);
		rerender(<App page="second" />);
		expect(screen.getByTestId("second")).toHaveTextContent("ready");
		expect(loading.loads).toBe(1);
	});

	it("tries again on request while the same page stays open", async () => {
		const user = userEvent.setup();
		loading.failures = 1;
		render(<App page="first" />);
		await waitFor(() =>
			expect(screen.getByTestId("first")).toHaveTextContent("failed"),
		);
		await user.click(screen.getByRole("button", { name: "retry" }));
		await waitFor(() =>
			expect(screen.getByTestId("first")).toHaveTextContent("ready"),
		);
		expect(loading.loads).toBe(2);
	});
});
