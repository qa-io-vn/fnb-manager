import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	dataEndpointFrom,
	LOCAL_SUPABASE_PATH,
	STAND_IN_DATA,
} from "../../src/data/endpoint";
import {
	MiniApp,
	sharedCatalogs,
	useDataEndpoint,
} from "../../src/react/index";
import type { SessionClient } from "../../src/session/types";

const pendingClient: SessionClient = {
	connect: () => new Promise(() => undefined),
	start: () => new Promise(() => undefined),
	bind: () => new Promise(() => undefined),
	pair: () => new Promise(() => undefined),
	acceptNotice: () => new Promise(() => undefined),
	texts: () => new Promise(() => undefined),
	forget: () => undefined,
};

function Probe() {
	const endpoint = useDataEndpoint();
	return <p data-testid="endpoint">{JSON.stringify(endpoint)}</p>;
}

describe("where a Mini App reads its data", () => {
	it("is the configured Supabase URL in Zalo, the dev server's /supabase in local mode and sample data otherwise", () => {
		expect(
			dataEndpointFrom({
				runtime: "zalo",
				session: "stand-in",
				supabaseUrl: " https://project.example.com/ ",
				publishableKey: "publishable-test",
			}),
		).toEqual({
			kind: "supabase",
			url: "https://project.example.com",
			publishableKey: "publishable-test",
		});
		expect(
			dataEndpointFrom({
				runtime: "browser",
				session: "local",
				supabaseUrl: undefined,
				publishableKey: "publishable-local",
			}),
		).toEqual({
			kind: "supabase",
			url: LOCAL_SUPABASE_PATH,
			publishableKey: "publishable-local",
		});
		expect(LOCAL_SUPABASE_PATH).toBe("/supabase");
		for (const session of ["stand-in", "", undefined]) {
			expect(
				dataEndpointFrom({
					runtime: "browser",
					session,
					supabaseUrl: "https://project.example.com",
					publishableKey: "publishable-test",
				}),
			).toEqual(STAND_IN_DATA);
		}
	});

	it("reaches every screen through the shell, sample data by default", () => {
		const renderWith = (
			dataEndpoint?: Parameters<typeof dataEndpointFrom>[0],
		) =>
			render(
				<MiniApp
					language="vi"
					catalogs={sharedCatalogs}
					sessionClient={pendingClient}
					routes={[{ path: "/", element: <Probe /> }]}
					tabs={[]}
					standInHeader={null}
					{...(dataEndpoint === undefined
						? {}
						: { dataEndpoint: dataEndpointFrom(dataEndpoint) })}
				/>,
			);
		const first = renderWith();
		expect(screen.getByTestId("endpoint")).toHaveTextContent(
			JSON.stringify(STAND_IN_DATA),
		);
		first.unmount();
		renderWith({
			runtime: "browser",
			session: "local",
			supabaseUrl: undefined,
			publishableKey: "publishable-local",
		});
		expect(screen.getByTestId("endpoint")).toHaveTextContent(
			'"url":"/supabase"',
		);
	});
});
