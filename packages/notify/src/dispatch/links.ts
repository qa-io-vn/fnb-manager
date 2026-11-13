import {
	type ChannelAdapter,
	type ChannelKind,
	type FetchLike,
	PollError,
	REQUEST_TIMEOUT_MS,
	USER_AGENT,
} from "../channels/types.js";
import type { NotifyRepository } from "./repository.js";

export const LINK_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const POLL_LEASE_SECONDS = 30;

const LINK_CODE_PATTERN = /(?:^|[^A-Za-z0-9])(FNB-[A-Z0-9]{8})(?![A-Za-z0-9])/i;
const ACCEPTANCE = "dong y";
const EDGE_PUNCTUATION = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu;
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { readonly code?: unknown }).code === UNIQUE_VIOLATION
	);
}

async function completeLinkOrDiscard(
	repository: NotifyRepository,
	...args: Parameters<NotifyRepository["completeChannelLink"]>
): Promise<string | null> {
	try {
		return await repository.completeChannelLink(...args);
	} catch (error) {
		if (isUniqueViolation(error)) {
			return null;
		}
		throw error;
	}
}

export function findLinkCode(text: string): string | null {
	const match = LINK_CODE_PATTERN.exec(text.normalize("NFC").trim());
	return match?.[1] ? match[1].toUpperCase() : null;
}

export function foldVietnamese(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/đ/g, "d")
		.replace(/Đ/g, "D")
		.normalize("NFC")
		.toLowerCase();
}

export function isAcceptance(text: string): boolean {
	const folded = foldVietnamese(text)
		.replace(EDGE_PUNCTUATION, "")
		.replace(/\s+/g, " ");
	return folded === ACCEPTANCE;
}

export function addressHint(address: string): string {
	const tail = address.slice(-4);
	return `…${tail}`;
}

export interface PollRound {
	readonly outcome: "polled" | "lease_held" | "error";
	readonly code: string | null;
	readonly matched: number;
	readonly accepted: number;
	readonly discarded: number;
}

export interface PollBotOptions {
	readonly repository: NotifyRepository;
	readonly adapter: ChannelAdapter;
	readonly kind: ChannelKind;
	readonly secretName: string;
	readonly secret: string;
	readonly baseUrl: string;
	readonly worker: string;
	readonly clock: () => Date;
	readonly fetch: FetchLike;
	readonly waitSeconds: number;
	readonly release: boolean;
	readonly leaseSeconds?: number;
}

export async function pollBot(options: PollBotOptions): Promise<PollRound> {
	const { repository, adapter, kind, secretName, worker, clock, release } =
		options;
	const taken = await repository.takePollLease(
		secretName,
		kind,
		worker,
		options.leaseSeconds ?? POLL_LEASE_SECONDS,
		clock(),
	);
	if (!taken) {
		return {
			outcome: "lease_held",
			code: null,
			matched: 0,
			accepted: 0,
			discarded: 0,
		};
	}
	let matched = 0;
	let accepted = 0;
	let discarded = 0;
	try {
		if (!adapter.pollUpdates) {
			return {
				outcome: "error",
				code: "polling_unsupported",
				matched,
				accepted,
				discarded,
			};
		}
		const cursor = await repository.pollCursor(secretName);
		let result: Awaited<ReturnType<NonNullable<ChannelAdapter["pollUpdates"]>>>;
		try {
			result = await adapter.pollUpdates(
				{
					secret: options.secret,
					fetch: options.fetch,
					baseUrl: options.baseUrl,
					timeoutMs: REQUEST_TIMEOUT_MS,
					userAgent: USER_AGENT,
					now: clock,
				},
				cursor,
				options.waitSeconds,
			);
		} catch (error) {
			return {
				outcome: "error",
				code: error instanceof PollError ? error.code : "poll_failed",
				matched,
				accepted,
				discarded,
			};
		}
		for (const update of result.updates) {
			if (update.chatType !== "private") {
				discarded += 1;
				continue;
			}
			const code = findLinkCode(update.text);
			if (code !== null) {
				const linked = await completeLinkOrDiscard(
					repository,
					kind,
					secretName,
					code,
					update.chatId,
					addressHint(update.chatId),
					clock(),
				);
				if (linked === null) {
					discarded += 1;
				} else {
					matched += 1;
				}
				continue;
			}
			if (isAcceptance(update.text)) {
				const activated = await repository.acceptChannelLink(
					kind,
					secretName,
					update.chatId,
					clock(),
				);
				if (activated === null) {
					discarded += 1;
				} else {
					accepted += 1;
				}
				continue;
			}
			discarded += 1;
		}
		await repository.savePollState(secretName, worker, result.cursor, clock());
		return { outcome: "polled", code: null, matched, accepted, discarded };
	} finally {
		if (release) {
			await repository.releasePollLease(secretName, worker);
		}
	}
}
