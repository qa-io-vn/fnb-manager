import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	MAX_TABS,
	MiniApp,
	type MiniAppRoute,
	type MiniAppTab,
	PlainState,
	SessionScreen,
	sharedCatalogs,
	shellProblems,
} from "../../src/react/index";
import {
	createStandInSessionClient,
	STAND_IN_NOTICE,
} from "../../src/session/stand-in";
import type { SessionClient } from "../../src/session/types";
import { createMemoryStorage } from "../../src/storage/native-storage";

const routes: readonly MiniAppRoute[] = ["/", "/a", "/b", "/c", "/d"].map(
	(path) => ({ path, element: <PlainState /> }),
);

function tabsFor(paths: readonly string[]): MiniAppTab[] {
	return paths.map((path) => ({
		path,
		labelKey: "shell.plainState",
		icon: null,
	}));
}

const pendingClient: SessionClient = {
	connect: () => new Promise(() => undefined),
	bind: () => new Promise(() => undefined),
	pair: () => new Promise(() => undefined),
	acceptNotice: () => new Promise(() => undefined),
	forget: () => undefined,
};

describe("Mini App shell rules", () => {
	it("allow no tabs or two to four tabs that start with the first route", () => {
		expect(shellProblems(routes, [])).toEqual([]);
		expect(shellProblems(routes, tabsFor(["/", "/a"]))).toEqual([]);
		expect(shellProblems(routes, tabsFor(["/", "/a", "/b", "/c"]))).toEqual([]);
	});

	it("refuse a fifth tab, a lone tab, a first tab elsewhere and a tab without a route", () => {
		expect(
			shellProblems(routes, tabsFor(["/", "/a", "/b", "/c", "/d"])),
		).toEqual([`a Mini App has at most ${MAX_TABS} tabs`]);
		expect(shellProblems(routes, tabsFor(["/"]))).toEqual([
			"a bottom navigation needs two tabs",
		]);
		expect(shellProblems(routes, tabsFor(["/a", "/"]))).toEqual([
			"the first tab must open the first route",
		]);
		expect(shellProblems(routes, tabsFor(["/", "/x"]))).toEqual([
			"no route for the tab /x",
		]);
		expect(shellProblems(routes.slice(1), [])).toEqual([
			"the first route must be /",
		]);
	});

	it("refuses to render five tabs", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		expect(() =>
			render(
				<MiniApp
					language="vi"
					catalogs={sharedCatalogs}
					sessionClient={pendingClient}
					routes={routes}
					tabs={tabsFor(["/", "/a", "/b", "/c", "/d"])}
					standInHeader={null}
				/>,
			),
		).toThrow("a Mini App has at most 4 tabs");
		consoleError.mockRestore();
	});

	it("renders the first route first, without a stand-in header inside Zalo", () => {
		render(
			<MiniApp
				language="vi"
				catalogs={sharedCatalogs}
				sessionClient={pendingClient}
				routes={routes}
				tabs={tabsFor(["/", "/a"])}
				standInHeader={null}
			/>,
		);
		expect(screen.getByTestId("plain-state")).toBeInTheDocument();
		expect(screen.queryByTestId("stand-in-header")).not.toBeInTheDocument();
		expect(document.body.getAttribute("zaui-theme")).toBe("light");
	});
});

describe("the session screen for a staff notice to accept", () => {
	function renderSession(client: SessionClient) {
		return render(
			<MiniApp
				language="vi"
				catalogs={sharedCatalogs}
				sessionClient={client}
				routes={[{ path: "/", element: <SessionScreen /> }]}
				tabs={[]}
				standInHeader={null}
			/>,
		);
	}

	it("shows the published notice as plain text and signs in once it is accepted", async () => {
		renderSession(
			createStandInSessionClient({
				settings: { scenario: "notice", delayMs: 0 },
				member: { displayName: "Nhân viên thử", role: "staff", stores: [] },
				storage: createMemoryStorage(),
				getAccessToken: async () => "mock-token",
			}),
		);
		expect(
			await screen.findByRole("heading", { name: STAND_IN_NOTICE.title }),
		).toBeInTheDocument();
		expect(screen.getByTestId("staff-notice")).toHaveTextContent(
			STAND_IN_NOTICE.bodyMarkdown,
		);
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Đồng ý" }));
		expect(
			await screen.findByRole("heading", { name: "Xin chào, Nhân viên thử" }),
		).toBeInTheDocument();
	});

	it("says whom to ask when no notice is published", async () => {
		const client: SessionClient = {
			...pendingClient,
			connect: async () => ({ status: "notice-required", notice: null }),
		};
		renderSession(client);
		expect(
			await screen.findByText(
				"Chưa có thông báo cho nhân viên. Hãy liên hệ quản lý cửa hàng.",
			),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Thử lại" })).toBeEnabled();
	});
});
