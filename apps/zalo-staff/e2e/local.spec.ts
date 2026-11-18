import { type ChildProcess, fork } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, test } from "@playwright/test";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = fileURLToPath(
	new URL("../../../scripts/zalo-dev.mjs", import.meta.url),
);
const PORT = String(5761 + Number(process.env.E2E_PORT_OFFSET ?? "0"));
const ROLE_LABELS: Readonly<Record<string, string>> = {
	owner: "Chủ cửa hàng",
	manager: "Quản lý",
	staff: "Nhân viên",
	viewer: "Người xem",
};
const LOOPBACK_API = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/;

interface Ready {
	readonly type: "ready";
	readonly appUrl: string;
	readonly role: string;
	readonly stores: number;
	readonly mockName: string;
	readonly boundNow: boolean;
}

function localApiUrl(): string {
	const file = `${ROOT}.env`;
	const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
	const url = (process.env.SUPABASE_URL || fromFile.SUPABASE_URL || "").trim();
	return LOOPBACK_API.test(url) ? url : "";
}

async function reachable(url: string): Promise<boolean> {
	if (url === "") return false;
	try {
		const response = await fetch(`${url}/auth/v1/health`, {
			signal: AbortSignal.timeout(3000),
		});
		await response.body?.cancel();
		return true;
	} catch {
		return false;
	}
}

let loop: ChildProcess | null = null;
const output: string[] = [];

function startLoop(): Promise<Ready> {
	const child = fork(SCRIPT, ["--port", PORT], {
		cwd: ROOT,
		stdio: ["ignore", "pipe", "pipe", "ipc"],
	});
	loop = child;
	for (const stream of [child.stdout, child.stderr]) {
		stream?.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
	}
	return new Promise((resolve, reject) => {
		child.on("message", (message: Ready) => {
			if (message.type === "ready") resolve(message);
		});
		child.on("exit", (code) =>
			reject(
				new Error(`pnpm zalo:dev exited with ${code}:\n${output.join("")}`),
			),
		);
	});
}

function stopLoop(child: ChildProcess): Promise<number | null> {
	return new Promise((resolve) => {
		child.on("exit", (code) => resolve(code));
		child.send({ type: "stop" });
	});
}

test.afterAll(async () => {
	const child = loop;
	if (child === null || child.exitCode !== null) return;
	const exited = new Promise((resolve) => child.once("exit", resolve));
	if (child.connected) child.send({ type: "stop" });
	await Promise.race([
		exited,
		new Promise((resolve) => setTimeout(resolve, 30_000)),
	]);
	if (child.exitCode === null) child.kill();
});

test("pnpm zalo:dev signs the mock Zalo user in through the real zalo-session and stops cleanly", async ({
	page,
}) => {
	test.skip(
		process.env.ZALO_LOCAL_DEV !== "1" || !(await reachable(localApiUrl())),
		"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev",
	);
	const ready = await startLoop();
	expect(ready.appUrl).toBe(`http://127.0.0.1:${PORT}/`);
	expect(ready.stores).toBeGreaterThan(0);

	await watchMiniAppPage(page);
	const hosts = new Set<string>();
	page.on("request", (request) => hosts.add(new URL(request.url()).host));
	const session = page.waitForResponse(
		(response) =>
			response.url().endsWith("/functions/v1/zalo-session") &&
			response.request().method() === "POST",
	);
	await page.goto(ready.appUrl);
	const answer = await session;
	expect(answer.status()).toBe(200);
	expect((await answer.json()).status).toBe("bound");

	await expect(
		page.getByRole("heading", { name: `Xin chào, ${ready.mockName}` }),
	).toBeVisible();
	await expect(page.getByTestId("member-role")).toHaveText(
		ROLE_LABELS[ready.role] ?? ready.role,
	);
	await expect(
		page.getByTestId("member-stores").getByRole("listitem"),
	).toHaveCount(ready.stores);
	await expect(page.getByTestId("stand-in-header")).toBeVisible();
	await checkMiniAppScreen(page);
	expect([...hosts]).toEqual([`127.0.0.1:${PORT}`]);

	const child = loop;
	expect(child).not.toBeNull();
	if (child === null) return;
	expect(await stopLoop(child)).toBe(0);
	await expect(fetch(ready.appUrl)).rejects.toThrow();
});
