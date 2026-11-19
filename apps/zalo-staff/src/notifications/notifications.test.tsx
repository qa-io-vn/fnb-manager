import type { RestClient } from "@fnb/zalo-mini";
import { mockSdkCalls, resetMockSdk } from "@fnb/zalo-mini/testing/mock-sdk";
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRestTeamClient } from "../team/client";
import { DEMO_OA_ID } from "../team/demo";
import { TEAM_PATHS } from "../team/env";
import { renderStaffApp } from "../test/render-app";
import { primaryActions, renderTeam, screenReady } from "../test/team-harness";
import {
	DESTINATION_TABLE,
	destinationQuery,
	destinationState,
	readDestinations,
} from "./contract";

const MEMBER = "00000000-0000-4000-8000-00000000b001";

interface FakeRest extends RestClient {
	readonly selects: { table: string; query: Record<string, string> }[];
	readonly calls: string[];
}

function fakeRest(rows: unknown[]): FakeRest {
	const selects: { table: string; query: Record<string, string> }[] = [];
	const calls: string[] = [];
	return {
		selects,
		calls,
		async select(table, query) {
			selects.push({ table, query: { ...query } });
			return rows;
		},
		async rpc(fn) {
			calls.push(fn);
			return [];
		},
	};
}

const LIVE_ROWS = [
	{
		id: "c1",
		kind: "zalo_bot",
		label: "Zalo Bot",
		address_hint: "…9b2c",
		status: "pending",
		enabled: true,
		muted_rules: [],
		linked_at: null,
		disabled_reason: null,
	},
	{
		id: "c2",
		kind: "email",
		label: "E-mail",
		address_hint: "n…@example.com",
		status: "disabled",
		enabled: true,
		muted_rules: ["daily_digest", "ticket_drop"],
		linked_at: "2026-11-01T00:00:00+00:00",
		disabled_reason: "consent_withdrawn",
	},
];

beforeEach(() => {
	resetMockSdk();
});

afterEach(() => {
	window.history.replaceState(null, "", "/");
});

describe("the destinations answer", () => {
	it("reads the member's own destinations and their state", () => {
		expect(destinationQuery(MEMBER)).toEqual({
			select:
				"id,kind,label,address_hint,status,enabled,muted_rules,linked_at,disabled_reason",
			user_id: `eq.${MEMBER}`,
			order: "created_at.asc,id.asc",
		});
		const destinations = readDestinations(LIVE_ROWS);
		expect(destinations.map(destinationState)).toEqual(["waiting", "stopped"]);
		expect(destinations[1]).toMatchObject({
			kind: "email",
			mutedRules: 2,
			disabledReason: "consent_withdrawn",
		});
		expect(
			destinationState({
				...(destinations[0] as (typeof destinations)[number]),
				status: "active",
				paused: true,
			}),
		).toBe("stopped");
	});
});

describe("Nhận thông báo", () => {
	it("is reached from the Cá nhân tab", async () => {
		renderStaffApp();
		const navigation = await screen.findByRole("navigation", {
			name: "Điều hướng chính",
		});
		fireEvent.click(
			within(navigation).getByRole("button", { name: "Cá nhân" }),
		);
		const section = await screen.findByTestId("profile-notifications");
		fireEvent.click(
			within(section).getByRole("button", { name: "Cài đặt nhận thông báo" }),
		);
		expect(await screen.findByTestId("destination-list")).toBeInTheDocument();
	});

	it("lists the destinations and shows what the server cannot do yet as not ready", async () => {
		renderTeam({ path: TEAM_PATHS.notifications });
		const list = await screenReady("destination-list");
		const items = within(list).getAllByTestId("destination");
		expect(items).toHaveLength(1);
		expect(items[0]).toHaveTextContent("Zalo Bot");
		expect(items[0]).toHaveTextContent("…3f7a");
		expect(
			within(items[0] as HTMLElement).getByTestId("destination-state"),
		).toHaveTextContent("Đang nhận");
		for (const id of ["bot-not-ready", "mute-not-ready", "stop-not-ready"]) {
			expect(screen.getByTestId(id)).toHaveTextContent("Chưa sẵn sàng");
		}
		expect(screen.getByTestId("notify-group")).toHaveTextContent(
			"Nhờ quản lý thêm bạn vào nhóm Zalo nhân viên",
		);
		expect(document.querySelectorAll("a")).toHaveLength(0);
		expect(primaryActions()).toHaveLength(0);
	});

	it("asks to follow the OA only after its purpose line, and only on a tap", async () => {
		renderTeam({ path: TEAM_PATHS.notifications });
		const follow = await screenReady("notify-follow");
		const purpose = await within(follow).findByTestId("follow-purpose");
		expect(purpose).toHaveTextContent(
			"Theo dõi OA để nhận tin vận hành ngay trong Zalo.",
		);
		const button = within(follow).getByRole("button", { name: "Theo dõi OA" });
		expect(
			purpose.compareDocumentPosition(button) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(mockSdkCalls().filter((call) => call.api === "followOA")).toEqual(
			[],
		);
		fireEvent.click(button);
		expect(await within(follow).findByTestId("follow-done")).toHaveTextContent(
			"Bạn đã theo dõi OA.",
		);
		expect(mockSdkCalls().filter((call) => call.api === "followOA")).toEqual([
			expect.objectContaining({ args: { id: DEMO_OA_ID } }),
		]);
	});

	it("changes nothing else when the follow is refused", async () => {
		window.history.replaceState(null, "", "/?follow=refused");
		renderTeam({ path: TEAM_PATHS.notifications });
		const follow = await screenReady("notify-follow");
		fireEvent.click(
			await within(follow).findByRole("button", { name: "Theo dõi OA" }),
		);
		expect(
			await within(follow).findByTestId("follow-refused"),
		).toHaveTextContent("Bạn chưa theo dõi OA.");
		expect(
			within(follow).getByRole("button", { name: "Theo dõi OA" }),
		).toBeEnabled();
		expect(screen.getAllByTestId("destination")).toHaveLength(1);
		expect(screen.getByTestId("destination-state")).toHaveTextContent(
			"Đang nhận",
		);
	});

	it("reads the live destinations of the signed-in member and shows the follow step as not ready", async () => {
		const rest = fakeRest(LIVE_ROWS);
		renderTeam({
			path: TEAM_PATHS.notifications,
			client: createRestTeamClient(rest, MEMBER),
			memberId: MEMBER,
		});
		const list = await screenReady("destination-list");
		const items = within(list).getAllByTestId("destination");
		expect(items.map((item) => item.dataset.state)).toEqual([
			"waiting",
			"stopped",
		]);
		expect(items[0]).toHaveTextContent(
			"Trả lời ĐỒNG Ý trong khung chat với Bot",
		);
		expect(
			within(items[1] as HTMLElement).getByTestId("destination-reason"),
		).toHaveTextContent("Bạn đã dừng nhận thông báo.");
		expect(
			within(items[1] as HTMLElement).getByTestId("destination-muted"),
		).toHaveTextContent("Đã tắt 2 loại tin ở nơi nhận này.");
		expect(await screen.findByTestId("follow-not-ready")).toHaveTextContent(
			"Ứng dụng chưa biết OA của cửa hàng.",
		);
		expect(rest.selects).toEqual([
			{ table: DESTINATION_TABLE, query: destinationQuery(MEMBER) },
		]);
		expect(rest.calls).toEqual([]);
	});

	it("shows no destination when the session has no member id", async () => {
		const rest = fakeRest(LIVE_ROWS);
		renderTeam({
			path: TEAM_PATHS.notifications,
			client: createRestTeamClient(rest, null),
			memberId: null,
		});
		expect(await screen.findByTestId("destinations-empty")).toHaveTextContent(
			"Bạn chưa liên kết nơi nhận nào.",
		);
		expect(rest.selects).toEqual([]);
	});
});
