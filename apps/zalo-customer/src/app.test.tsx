import config from "virtual:mini-app-config";
import {
	createStandInSessionClient,
	fromZmpNativeStorage,
	type StandInScenario,
} from "@fnb/zalo-mini";
import { MiniApp, shellProblems } from "@fnb/zalo-mini/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getAccessToken, nativeStorage } from "zmp-sdk";
import { routes, standInMember, tabs } from "./app";
import { catalogs } from "./i18n/catalog";

function renderApp(scenario: StandInScenario) {
	nativeStorage.clear();
	return render(
		<MiniApp
			language="vi"
			catalogs={catalogs}
			sessionClient={createStandInSessionClient({
				settings: { scenario, delayMs: 0 },
				member: standInMember,
				storage: fromZmpNativeStorage(nativeStorage),
				getAccessToken: () => getAccessToken(),
			})}
			routes={routes}
			tabs={tabs}
			standInHeader={config.app}
		/>,
	);
}

describe("customer Mini App shell", () => {
	it("shows only the session check for the owner, with no bottom navigation", async () => {
		renderApp("bound");
		expect(screen.getByRole("status")).toHaveTextContent("Đang kết nối…");
		expect(
			await screen.findByRole("heading", {
				name: "Xin chào, Chủ cửa hàng thử",
			}),
		).toBeInTheDocument();
		expect(screen.getByTestId("member-role")).toHaveTextContent("Chủ cửa hàng");
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		expect(tabs).toEqual([]);
		expect(shellProblems(routes, tabs)).toEqual([]);
	});

	it("shows the unpaired instructions", async () => {
		renderApp("unpaired");
		expect(
			await screen.findByRole("heading", {
				name: "Tài khoản chưa được liên kết",
			}),
		).toBeInTheDocument();
		expect(screen.getByLabelText("Mã liên kết")).toBeInTheDocument();
	});

	it("builds its configuration for the customer app", () => {
		expect(config.kind).toBe("customer");
		expect(config.app.title.length).toBeGreaterThanOrEqual(3);
	});
});
