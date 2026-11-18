import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	MiniApp,
	type MiniAppTab,
	PlainState,
	Popup,
	RESULT_MODAL_MS,
	ResultModal,
	SessionScreen,
	sharedCatalogs,
	useSession,
} from "../../src/react/index";
import type { SessionClient, SessionState } from "../../src/session/types";

function clientAnswering(
	first: SessionState,
	started: SessionState,
): SessionClient & { readonly forgotten: () => number } {
	let forgets = 0;
	return {
		connect: async () => first,
		start: async () => started,
		bind: () => new Promise(() => undefined),
		pair: () => new Promise(() => undefined),
		acceptNotice: () => new Promise(() => undefined),
		texts: async () => null,
		forget: () => {
			forgets += 1;
		},
		forgotten: () => forgets,
	};
}

const tabs: readonly MiniAppTab[] = [
	{ path: "/", labelKey: "shell.plainState", icon: null },
	{ path: "/a", labelKey: "shell.plainState", icon: null },
];

function Gate({ children }: { readonly children: ReactNode }) {
	const { state, start, expire } = useSession();
	if (state.status === "signed-in") {
		return (
			<>
				{children}
				<button type="button" onClick={expire}>
					expire
				</button>
			</>
		);
	}
	return (
		<main data-testid="gate" data-status={state.status}>
			<button type="button" onClick={start}>
				start
			</button>
		</main>
	);
}

const signedIn: SessionState = {
	status: "signed-in",
	session: {
		accessToken: "session-a",
		refreshToken: "",
		expiresAt: 4_000_000_000,
		member: { displayName: "Thành viên thử", role: "staff", stores: [] },
	},
};

afterEach(() => {
	vi.useRealTimers();
});

describe("the entry gate of the shell", () => {
	it("shows only the gate, without routes or tabs, until the member is signed in", async () => {
		render(
			<MiniApp
				language="vi"
				catalogs={sharedCatalogs}
				sessionClient={clientAnswering({ status: "new" }, signedIn)}
				routes={[
					{ path: "/", element: <PlainState /> },
					{ path: "/a", element: <PlainState /> },
				]}
				tabs={tabs}
				standInHeader={null}
				gate={Gate}
			/>,
		);
		expect(await screen.findByTestId("gate")).toHaveAttribute(
			"data-status",
			"new",
		);
		expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
		expect(screen.queryByTestId("plain-state")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "start" }));
		expect(await screen.findByTestId("plain-state")).toBeInTheDocument();
		expect(screen.getByRole("navigation")).toBeInTheDocument();
	});

	it("drops a refused session and starts again with expire", async () => {
		const client = clientAnswering(signedIn, {
			status: "unpaired",
			codeRejected: false,
		});
		render(
			<MiniApp
				language="vi"
				catalogs={sharedCatalogs}
				sessionClient={client}
				routes={[{ path: "/", element: <PlainState /> }]}
				tabs={[]}
				standInHeader={null}
				gate={Gate}
			/>,
		);
		fireEvent.click(await screen.findByRole("button", { name: "expire" }));
		expect(await screen.findByTestId("gate")).toHaveAttribute(
			"data-status",
			"unpaired",
		);
		expect(client.forgotten()).toBe(1);
	});

	it("lets the shared session screen start a first open", async () => {
		render(
			<MiniApp
				language="vi"
				catalogs={sharedCatalogs}
				sessionClient={clientAnswering({ status: "new" }, signedIn)}
				routes={[{ path: "/", element: <SessionScreen /> }]}
				tabs={[]}
				standInHeader={null}
			/>,
		);
		fireEvent.click(await screen.findByRole("button", { name: "Tiếp tục" }));
		expect(
			await screen.findByRole("heading", { name: "Xin chào, Thành viên thử" }),
		).toBeInTheDocument();
	});
});

function PopupProbe() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				open
			</button>
			{open ? (
				<Popup title="Tiêu đề" onClose={() => setOpen(false)}>
					<p>Nội dung</p>
				</Popup>
			) : null}
		</>
	);
}

describe("popups and result modals", () => {
	function renderRoute(element: ReactNode) {
		return render(
			<MiniApp
				language="vi"
				catalogs={sharedCatalogs}
				sessionClient={clientAnswering(signedIn, signedIn)}
				routes={[{ path: "/", element }]}
				tabs={[]}
				standInHeader={null}
			/>,
		);
	}

	it("opens a labelled modal dialog, moves focus into it and gives it back on Escape", () => {
		renderRoute(<PopupProbe />);
		const opener = screen.getByRole("button", { name: "open" });
		opener.focus();
		fireEvent.click(opener);
		const dialog = screen.getByRole("dialog", { name: "Tiêu đề" });
		expect(dialog).toHaveAttribute("aria-modal", "true");
		expect(screen.getByRole("button", { name: "Đóng" })).toHaveFocus();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(opener).toHaveFocus();
	});

	it("closes a result modal after 1.5 s", () => {
		vi.useFakeTimers();
		const done = vi.fn();
		renderRoute(<ResultModal message="Đã xong" onDone={done} />);
		expect(screen.getByRole("status")).toHaveTextContent("Đã xong");
		act(() => {
			vi.advanceTimersByTime(RESULT_MODAL_MS - 1);
		});
		expect(done).not.toHaveBeenCalled();
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(done).toHaveBeenCalledTimes(1);
		expect(RESULT_MODAL_MS).toBe(1500);
	});
});
