import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	MiniApp,
	type MiniAppRoute,
	sharedCatalogs,
} from "../../src/react/index";
import { devRouteOf } from "../../src/react/mini-app-shell";
import type { SessionClient } from "../../src/session/types";

// Test design (ISTQB) for ?route= (Development builds only):
// - a decision table of the stage (development, testing, zalo, none) and the parameter (a good path, none, a bad one);
// - boundary values of the path: one segment, six segments, seven segments; and the characters allowed;
// - security: nothing that could leave the app (a host, a query, a dot, a backslash, an encoded dot, a scheme) is
//   navigated to, and a Testing build ignores the parameter altogether.

describe("devRouteOf", () => {
	it("gives the path in a Development build and nothing in any other stage", () => {
		for (const stage of ["testing", "production", "zalo", "", undefined]) {
			expect(devRouteOf("?route=/kit", stage), String(stage)).toBeNull();
		}
		expect(devRouteOf("?route=/kit", "development")).toBe("/kit");
	});

	it("gives nothing when there is no parameter or it is empty", () => {
		expect(devRouteOf("", "development")).toBeNull();
		expect(devRouteOf("?other=/kit", "development")).toBeNull();
		expect(devRouteOf("?route=", "development")).toBeNull();
		expect(devRouteOf("?route=/", "development")).toBeNull();
	});

	it("takes one to six segments and no more", () => {
		const path = (n: number) =>
			`/${Array.from({ length: n }, (_, i) => `s${i}`).join("/")}`;
		expect(devRouteOf(`?route=${path(1)}`, "development")).toBe(path(1));
		expect(devRouteOf(`?route=${path(6)}`, "development")).toBe(path(6));
		expect(devRouteOf(`?route=${path(7)}`, "development")).toBeNull();
	});

	it("takes letters, digits, dashes and underscores in a segment, and nothing else", () => {
		expect(devRouteOf("?route=/Cua_hang-9/ma-1", "development")).toBe(
			"/Cua_hang-9/ma-1",
		);
		for (const bad of [
			"kit",
			"//evil.example.com",
			"/..",
			"/a/../b",
			"/a.b",
			"/a?b=1",
			"/a#b",
			"/a b",
			"/a\\b",
			"/%2e%2e",
			"/a/",
			"/a//b",
			"https://evil.example.com/kit",
			"javascript:alert(1)",
			"/‮kit",
			"/kit\u0000",
		]) {
			expect(
				devRouteOf(`?route=${encodeURIComponent(bad)}`, "development"),
				bad,
			).toBeNull();
		}
	});
});

const idleClient: SessionClient = {
	connect: () => new Promise(() => undefined),
	start: () => new Promise(() => undefined),
	bind: () => new Promise(() => undefined),
	pair: () => new Promise(() => undefined),
	acceptNotice: () => new Promise(() => undefined),
	texts: () => new Promise(() => undefined),
	forget: () => undefined,
};

describe("the shell and ?route=", () => {
	const routes: readonly MiniAppRoute[] = [
		{ path: "/", element: <p>home</p> },
		{ path: "/kit", element: <p>the kit</p> },
	];

	function open(search: string) {
		window.history.replaceState({}, "", `/${search}`);
		return render(
			<MiniApp
				language="vi"
				catalogs={sharedCatalogs}
				routes={routes}
				tabs={[]}
				standInHeader={null}
				{...{ sessionClient: idleClient }}
			/>,
		);
	}

	afterEach(() => {
		vi.unstubAllEnvs();
		window.history.replaceState({}, "", "/");
	});

	it("opens the route in a Development build", async () => {
		vi.stubEnv("VITE_MINI_APP_STAGE", "development");
		open("?route=/kit");
		expect(await screen.findByText("the kit")).toBeTruthy();
	});

	it("ignores the parameter in a Testing build and starts at the first route", () => {
		vi.stubEnv("VITE_MINI_APP_STAGE", "testing");
		open("?route=/kit");
		expect(screen.getByText("home")).toBeTruthy();
		expect(screen.queryByText("the kit")).toBeNull();
	});

	it("stays at the first route for a path it cannot take, even in a Development build", () => {
		vi.stubEnv("VITE_MINI_APP_STAGE", "development");
		open("?route=//evil.example.com");
		expect(screen.getByText("home")).toBeTruthy();
	});
});
