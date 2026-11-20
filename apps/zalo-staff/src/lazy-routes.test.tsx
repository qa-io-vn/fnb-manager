import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routes } from "./app";
import { LOYALTY_PATHS } from "./loyalty/env";
import { TEAM_SCREENS } from "./team/screens";
import { renderStaffApp } from "./test/render-app";

const EXPECTED_SCREENS: Readonly<Record<string, string>> = {
	"/ca-lam": "shift",
	"/ca-nhan": "profile",
	[LOYALTY_PATHS.checkIn]: "check-in",
	[LOYALTY_PATHS.redeem]: "redemption",
	[LOYALTY_PATHS.lookup]: "member-lookup",
	[LOYALTY_PATHS.queue]: "loyalty-queue",
	[LOYALTY_PATHS.requests]: "my-requests",
	...Object.fromEntries(
		TEAM_SCREENS.map((entry) => [entry.path, entry.testId] as const),
	),
};

describe("every lazily loaded route", () => {
	it("is accounted for, so a new route cannot skip this check", () => {
		const paths = routes.map((route) => route.path).filter((p) => p !== "/");
		expect([...paths].sort()).toEqual(Object.keys(EXPECTED_SCREENS).sort());
	});

	for (const route of routes.filter((candidate) => candidate.path !== "/")) {
		it(`${route.path} loads its chunk and renders its screen`, async () => {
			// The shell opens "/" in a memory router, so each route is shown there.
			renderStaffApp({
				routes: routes.map((each) =>
					each.path === "/" ? { path: "/", element: route.element } : each,
				),
			});
			const testId = EXPECTED_SCREENS[route.path] as string;
			await waitFor(() =>
				expect(screen.getAllByTestId(testId).length).toBeGreaterThan(0),
			);
			expect(screen.queryByTestId("screen-loading")).not.toBeInTheDocument();
			expect(
				screen.queryByTestId("screen-load-failed"),
			).not.toBeInTheDocument();
		});
	}
});
