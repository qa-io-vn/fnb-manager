import { describe, expect, it } from "vitest";
import {
	addressHint,
	CLI_CYCLE_LIMITS,
	createAdapterRegistry,
	createCycleBudget,
	createZaloBotAdapter,
	findLinkCode,
	isAcceptance,
	LINK_CODE_ALPHABET,
	pollBot,
	runNotifyCycle,
} from "../../src/index.js";
import { fakeFetch } from "../support/fake-fetch.js";
import { MemoryRepository } from "../support/memory-repository.js";

const SECRET = "NOTIFY_ZALO_BOT_TOKEN";
const TOKEN = "synthetic-bot-token";

function event(chatId: string, text: string, chatType = "PRIVATE") {
	return {
		event_name: "message.text.received",
		message: {
			message_id: "m",
			date: 1,
			from: { id: chatId },
			chat: { id: chatId, chat_type: chatType },
			text,
		},
	};
}

function poll(
	repository: MemoryRepository,
	fake: ReturnType<typeof fakeFetch>,
	worker = "cli:1",
	release = true,
) {
	return pollBot({
		repository,
		adapter: createZaloBotAdapter(),
		kind: "zalo_bot",
		secretName: SECRET,
		secret: TOKEN,
		baseUrl: "http://127.0.0.1:9",
		worker,
		clock: () => new Date("2026-11-09T02:00:00.000Z"),
		fetch: fake.fetch,
		waitSeconds: 1,
		release,
	});
}

describe("link codes and acceptance", () => {
	it("finds a code in the forms a member sends", () => {
		expect(findLinkCode("FNB-7K3QX9MD")).toBe("FNB-7K3QX9MD");
		expect(findLinkCode(" fnb-7k3qx9md ")).toBe("FNB-7K3QX9MD");
		expect(findLinkCode("/start FNB-7K3QX9MD")).toBe("FNB-7K3QX9MD");
		expect(findLinkCode("mã của tôi: FNB-7K3QX9MD.")).toBe("FNB-7K3QX9MD");
		expect(findLinkCode("FNB-7K3QX9")).toBeNull();
		expect(findLinkCode("FNB-7K3QX9MDX")).toBeNull();
		expect(findLinkCode("XFNB-7K3QX9MD")).toBeNull();
		expect(findLinkCode("xin chào")).toBeNull();
		expect(LINK_CODE_ALPHABET).toHaveLength(31);
		expect(LINK_CODE_ALPHABET).not.toMatch(/[ILO01]/);
	});

	it("accepts ĐỒNG Ý with or without diacritics and refuses a refusal", () => {
		for (const text of [
			"ĐỒNG Ý",
			"đồng ý.",
			"DONG Y",
			"  Đồng   ý!  ",
			"dong y",
			"Đồng ý".normalize("NFD"),
		]) {
			expect(isAcceptance(text), text).toBe(true);
		}
		for (const text of [
			"không đồng ý",
			"đồng ý nhưng",
			"ok",
			"",
			"FNB-7K3QX9MD",
		]) {
			expect(isAcceptance(text), text).toBe(false);
		}
	});

	it("shows only the last four characters of a chat id", () => {
		expect(addressHint("synthetic-chat-3f7a")).toBe("…3f7a");
	});
});

describe("pollBot", () => {
	it("passes a code and then the acceptance of the same chat, and discards everything else", async () => {
		const repository = new MemoryRepository();
		repository.links.push({
			secretName: SECRET,
			kind: "zalo_bot",
			code: "FNB-7K3QX9MD",
			chatId: null,
			accepted: false,
			tenantId: "tenant-1",
		});
		const fake = fakeFetch();
		fake.answer(
			{
				status: 200,
				body: {
					ok: true,
					result: [
						event("synthetic-stranger", "xin chào"),
						event("synthetic-group", "FNB-7K3QX9MD", "GROUP"),
						event("synthetic-chat-1", "fnb-7k3qx9md"),
						event("synthetic-other", "ĐỒNG Ý"),
					],
				},
			},
			{
				status: 200,
				body: { ok: true, result: event("synthetic-chat-1", "Đồng ý") },
			},
		);
		const first = await poll(repository, fake);
		expect(first).toEqual({
			outcome: "polled",
			code: null,
			matched: 1,
			accepted: 0,
			discarded: 2,
		});
		expect(repository.links[0]?.chatId).toBe("synthetic-chat-1");
		const second = await poll(repository, fake);
		expect(second).toMatchObject({ matched: 0, accepted: 1, discarded: 0 });
		expect(repository.links[0]?.accepted).toBe(true);
		expect(repository.leases.size).toBe(0);
	});

	it("discards a code sent from a chat already linked to another destination of the bot", async () => {
		const repository = new MemoryRepository();
		repository.links.push({
			secretName: SECRET,
			kind: "zalo_bot",
			code: "FNB-7K3QX9MD",
			chatId: null,
			accepted: false,
			tenantId: "tenant-1",
		});
		const linkedElsewhere = "synthetic-chat-linked";
		const completeChannelLink = repository.completeChannelLink.bind(repository);
		repository.completeChannelLink = async (...args) => {
			if (args[3] === linkedElsewhere) {
				throw Object.assign(new Error("duplicate key value"), {
					code: "23505",
				});
			}
			return completeChannelLink(...args);
		};
		const fake = fakeFetch();
		fake.answer({
			status: 200,
			body: {
				ok: true,
				result: [
					event(linkedElsewhere, "FNB-7K3QX9MD"),
					event("synthetic-chat-1", "FNB-7K3QX9MD"),
				],
			},
		});
		const round = await poll(repository, fake);
		expect(round).toEqual({
			outcome: "polled",
			code: null,
			matched: 1,
			accepted: 0,
			discarded: 1,
		});
		expect(repository.links[0]?.chatId).toBe("synthetic-chat-1");
		expect(repository.leases.size).toBe(0);
	});

	it("still fails the round on any other database error and releases the lease", async () => {
		const repository = new MemoryRepository();
		repository.completeChannelLink = async () => {
			throw Object.assign(new Error("synthetic database failure"), {
				code: "08006",
			});
		};
		const fake = fakeFetch();
		fake.answer({
			status: 200,
			body: { ok: true, result: event("synthetic-chat-1", "FNB-7K3QX9MD") },
		});
		await expect(poll(repository, fake)).rejects.toThrow(
			"synthetic database failure",
		);
		expect(repository.leases.size).toBe(0);
	});

	it("does not poll without the bot's lease", async () => {
		const repository = new MemoryRepository();
		repository.leases.set(SECRET, "edge:other");
		const fake = fakeFetch();
		const round = await poll(repository, fake);
		expect(round.outcome).toBe("lease_held");
		expect(fake.requests).toHaveLength(0);
		expect(repository.leases.get(SECRET)).toBe("edge:other");
	});

	it("keeps the lease between rounds when the caller holds it for a wait", async () => {
		const repository = new MemoryRepository();
		const fake = fakeFetch();
		fake.answer({ status: 200, body: { ok: true, result: [] } });
		await poll(repository, fake, "cli:wait", false);
		expect(repository.leases.get(SECRET)).toBe("cli:wait");
	});

	it("ends a round with a short code when the provider refuses the poll", async () => {
		const repository = new MemoryRepository();
		const fake = fakeFetch();
		fake.answer({ status: 401, body: { ok: false, error_code: 401 } });
		const round = await poll(repository, fake);
		expect(round).toEqual({
			outcome: "error",
			code: "token_invalid",
			matched: 0,
			accepted: 0,
			discarded: 0,
		});
		expect(repository.leases.size).toBe(0);
	});

	it("polls inside a cycle only for bots with a pending link whose token this runtime holds", async () => {
		const repository = new MemoryRepository();
		repository.links.push(
			{
				secretName: SECRET,
				kind: "zalo_bot",
				code: "FNB-AAAAAAAA",
				chatId: null,
				accepted: false,
				tenantId: "tenant-1",
			},
			{
				secretName: "NOTIFY_ZALO_BOT_TOKEN_2",
				kind: "zalo_bot",
				code: "FNB-BBBBBBBB",
				chatId: null,
				accepted: false,
				tenantId: "tenant-1",
			},
		);
		const fake = fakeFetch();
		fake.answer({
			status: 200,
			body: { ok: true, result: event("synthetic-chat-1", "FNB-AAAAAAAA") },
		});
		const report = await runNotifyCycle({
			repository,
			adapters: createAdapterRegistry(),
			environment: { [SECRET]: TOKEN },
			runtime: "edge",
			worker: "edge:1",
			tenantId: "tenant-1",
			clock: () => new Date("2026-11-09T02:00:00.000Z"),
			fetch: fake.fetch,
			log: () => undefined,
			budget: createCycleBudget({ ...CLI_CYCLE_LIMITS, linkPollSeconds: 10 }),
			runSqlTick: false,
			dryRun: false,
			sleep: async () => undefined,
		});
		expect(report.get("poll_rounds")).toBe(1);
		expect(report.get("poll_skipped")).toBe(1);
		expect(report.get("links_matched")).toBe(1);
		expect(
			fake.requests.filter((request) => request.url.endsWith("/getUpdates")),
		).toHaveLength(1);
		expect(fake.requests[0]?.body).toEqual({ timeout: "5" });
	});
});
