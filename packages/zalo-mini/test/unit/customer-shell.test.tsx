import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import type { ConfigEnv, UserConfig } from "vite";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { useCustomerSession } from "../../src/react/customer-session";
import { MiniApp } from "../../src/react/mini-app-shell";
import type { CustomerSessionClient } from "../../src/session/customer-session-client";
import {
	EventName,
	emitMockOpenApp,
	events,
	followOA,
	getRouteParams,
	MOCK_PERMISSION_DENIED_CODE,
	MOCK_STORAGE_KEYS_GLOBAL,
	mockSdkCalls,
	nativeStorage,
	resetMockSdk,
} from "../../src/testing/mock-sdk";
import {
	miniApp,
	miniAppSettings,
	standInServerOptions,
} from "../../src/vite/index";

const KEY = "k".repeat(43);
const TUNNEL_HOST = "sample-words-here.trycloudflare.com";
const appRoot = mkdtempSync(join(tmpdir(), "fnb-mini-customer-"));
afterAll(() => rmSync(appRoot, { recursive: true, force: true }));

function setSearch(search: string) {
	window.history.replaceState({}, "", `/${search}`);
}

describe("the mocked SDK's customer calls", () => {
	beforeEach(() => resetMockSdk());
	afterEach(() => setSearch(""));

	it("reads the route parameters of the address", () => {
		setSearch("?store=mau-2&src=qr");
		expect(getRouteParams()).toEqual({ store: "mau-2", src: "qr" });
	});

	it("delivers OpenApp events to listeners until they leave", () => {
		const seen: unknown[] = [];
		const listener = (data: unknown) => seen.push(data);
		events.on(EventName.OpenApp, listener);
		emitMockOpenApp("/?store=mau-1");
		events.off(EventName.OpenApp, listener);
		emitMockOpenApp("/?store=mau-2");
		expect(seen).toEqual([{ path: "/?store=mau-1" }]);
	});

	it("records followOA and refuses it under ?follow=refused", async () => {
		await followOA({ id: "oa-1" });
		expect(mockSdkCalls()).toEqual([{ api: "followOA", args: { id: "oa-1" } }]);
		setSearch("?follow=refused");
		await expect(followOA({ id: "oa-1" })).rejects.toMatchObject({
			code: MOCK_PERMISSION_DENIED_CODE,
		});
	});

	it("publishes the Native Storage keys, never the values", () => {
		nativeStorage.setItem("fnb.customer-session", "secret");
		expect(
			(window as unknown as Record<string, unknown>)[MOCK_STORAGE_KEYS_GLOBAL],
		).toEqual(["fnb.customer-session"]);
		nativeStorage.removeItem("fnb.customer-session");
		expect(
			(window as unknown as Record<string, unknown>)[MOCK_STORAGE_KEYS_GLOBAL],
		).toEqual([]);
	});
});

function Status() {
	const { state } = useCustomerSession();
	return (
		<p data-testid="customer-state">
			{state.status === "ready"
				? `ready:${state.session.customer.customerId ?? "visitor"}`
				: state.status}
		</p>
	);
}

describe("the shell with a customer session", () => {
	it("connects the customer session without a staff session", async () => {
		let resolve: (
			value: Awaited<ReturnType<CustomerSessionClient["connect"]>>,
		) => void = () => undefined;
		const client: CustomerSessionClient = {
			connect: () =>
				new Promise((done) => {
					resolve = done;
				}),
			refresh: () => client.connect(),
			join: async () => ({ ok: false, failure: "refused" }),
			forget: () => undefined,
		};
		render(
			<MiniApp
				language="vi"
				catalogs={{ vi: {}, en: {} }}
				customerSessionClient={client}
				routes={[{ path: "/", element: <Status /> }]}
				tabs={[]}
				standInHeader={null}
			/>,
		);
		expect(screen.getByTestId("customer-state")).toHaveTextContent(
			"connecting",
		);
		await act(async () =>
			resolve({
				status: "ready",
				session: {
					accessToken: "a",
					refreshToken: "r",
					expiresAt: 1,
					customer: { tenantId: "t", customerId: null, displayName: null },
				},
			}),
		);
		expect(screen.getByTestId("customer-state")).toHaveTextContent(
			"ready:visitor",
		);
	});
});

describe("the guarded stand-in dev server of the customer demo loop", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("guards a stand-in dev server only when a key or tunnel host is given, never a build", () => {
		expect(miniAppSettings({}, "serve", appRoot)).not.toHaveProperty(
			"standInAccess",
		);
		expect(
			miniAppSettings({ ZALO_LOCAL_ACCESS_KEY: KEY }, "serve", appRoot)
				.standInAccess,
		).toEqual({ key: KEY, tunnelHost: null });
		expect(
			miniAppSettings(
				{ ZALO_LOCAL_ACCESS_KEY: KEY, ZALO_LOCAL_TUNNEL_HOST: TUNNEL_HOST },
				"serve",
				appRoot,
			).standInAccess,
		).toEqual({ key: KEY, tunnelHost: TUNNEL_HOST });
		expect(() =>
			miniAppSettings(
				{ ZALO_LOCAL_TUNNEL_HOST: TUNNEL_HOST },
				"serve",
				appRoot,
			),
		).toThrow("needs ZALO_LOCAL_ACCESS_KEY");
		expect(
			miniAppSettings({ ZALO_LOCAL_ACCESS_KEY: KEY }, "build", appRoot),
		).not.toHaveProperty("standInAccess");
		expect(standInServerOptions({ key: KEY, tunnelHost: null })).toEqual({});
		expect(standInServerOptions({ key: KEY, tunnelHost: TUNNEL_HOST })).toEqual(
			{
				allowedHosts: [TUNNEL_HOST],
				hmr: false,
			},
		);
	});

	it("puts the guard in front of the stand-in dev server and allows only the tunnel host", () => {
		vi.stubEnv("ZALO_LOCAL_ACCESS_KEY", KEY);
		vi.stubEnv("ZALO_LOCAL_TUNNEL_HOST", TUNNEL_HOST);
		const main = miniApp({ kind: "customer", appRoot }).find(
			(plugin) => plugin.name === "fnb-mini-app",
		);
		const config = main?.config as (
			config: UserConfig,
			env: ConfigEnv,
		) => UserConfig;
		const resolved = config({}, { command: "serve", mode: "development" });
		expect(resolved.server).toEqual({
			allowedHosts: [TUNNEL_HOST],
			hmr: false,
		});
		const hook = main?.configureServer as {
			readonly handler: (server: unknown) => (() => void) | undefined;
		};
		const used: unknown[] = [];
		hook.handler({
			middlewares: { use: (handler: unknown) => used.push(handler) },
		});
		expect(used).toHaveLength(1);
	});
});
