import type {
	BeginSendResult,
	ChannelKind,
	ClaimedMessage,
	ClaimRequest,
	FinishRequest,
	MessageKind,
	NotifyRepository,
	PendingLinkBot,
	ProviderId,
	TickSummary,
} from "../../src/index.js";

export interface MemoryMessage {
	id: string;
	tenantId: string;
	kind: MessageKind;
	status: string;
	channelId: string;
	channelKind: ChannelKind;
	provider: ProviderId;
	secretName: string;
	address: string;
	title: string | null;
	body: string | null;
	attempts: number;
	claimedAt: string | null;
	sendStartedAt: Date | null;
	notBefore: Date | null;
	lastErrorCode: string | null;
	providerMessageId: string | null;
	finishes: FinishRequest[];
	begins: number;
}

export interface MemoryLink {
	secretName: string;
	kind: ChannelKind;
	code: string;
	chatId: string | null;
	accepted: boolean;
	tenantId: string;
}

export class MemoryRepository implements NotifyRepository {
	readonly messages: MemoryMessage[] = [];
	readonly links: MemoryLink[] = [];
	readonly dispatches: {
		runtime: string;
		secretNames: readonly string[];
		counts: Record<string, number>;
	}[] = [];
	readonly leases = new Map<string, string>();
	readonly cursors = new Map<string, number | null>();
	readonly ticks: { at: Date; tenantId: string | null }[] = [];
	readonly claims: ClaimRequest[] = [];
	stealLeaseOnBegin = false;
	failFinishes = 0;
	private counter = 0;

	addMessage(
		partial: Partial<MemoryMessage> & Pick<MemoryMessage, "kind">,
	): MemoryMessage {
		this.counter += 1;
		const message: MemoryMessage = {
			id: `00000000-0000-4000-8000-${String(this.counter).padStart(12, "0")}`,
			tenantId: "tenant-1",
			status: "queued",
			channelId: "channel-1",
			channelKind: "zalo_bot",
			provider: "zalo_bot",
			secretName: "NOTIFY_ZALO_BOT_TOKEN",
			address: "synthetic-chat-1",
			title: null,
			body: null,
			attempts: 0,
			claimedAt: null,
			sendStartedAt: null,
			notBefore: null,
			lastErrorCode: null,
			providerMessageId: null,
			finishes: [],
			begins: 0,
			...partial,
		};
		this.messages.push(message);
		return message;
	}

	async tick(
		at: Date,
		_post: boolean,
		tenantId: string | null,
	): Promise<TickSummary> {
		this.ticks.push({ at, tenantId });
		return { recovered: 0 };
	}

	async claimNext(request: ClaimRequest): Promise<ClaimedMessage | null> {
		this.claims.push(request);
		const message = this.messages.find(
			(candidate) =>
				candidate.status === "queued" &&
				request.secretNames.includes(candidate.secretName) &&
				(request.tenantId === null ||
					candidate.tenantId === request.tenantId) &&
				(candidate.notBefore === null || candidate.notBefore <= request.at),
		);
		if (!message) {
			return null;
		}
		message.status = "sending";
		message.attempts += 1;
		message.claimedAt = request.at.toISOString();
		message.sendStartedAt = null;
		return {
			messageId: message.id,
			claimedAt: message.claimedAt,
			tenantId: message.tenantId,
			kind: message.kind,
			templateRef: `${message.kind}.v1`,
			params: {},
			title: message.title,
			body: message.body,
			severity: null,
			attempts: message.attempts,
			businessDate: null,
			channelId: message.channelId,
			channelKind: message.channelKind,
			provider: message.provider,
			secretName: message.secretName,
			address: message.address,
			config: {},
			channelLabel: "Zalo Bot",
			readerTimezone: "Asia/Ho_Chi_Minh",
			tenantName: "Quán thử nghiệm",
			currencyCode: "VND",
			storeName: null,
			accountName: null,
			ruleKey: null,
		};
	}

	async beginSend(
		messageId: string,
		claimedAt: string,
		title: string | null,
		body: string,
		_bodySha256: string,
		at: Date,
	): Promise<BeginSendResult> {
		const message = this.messages.find(
			(candidate) => candidate.id === messageId,
		);
		if (
			!message ||
			message.claimedAt !== claimedAt ||
			message.status !== "sending" ||
			this.stealLeaseOnBegin
		) {
			return { ok: false, title: null, body: null };
		}
		message.begins += 1;
		if (message.body === null) {
			message.title = title;
			message.body = body;
		}
		message.sendStartedAt = at;
		return { ok: true, title: message.title, body: message.body };
	}

	async finishSend(request: FinishRequest): Promise<string> {
		if (this.failFinishes > 0) {
			this.failFinishes -= 1;
			throw new Error("synthetic database failure");
		}
		const message = this.messages.find(
			(candidate) => candidate.id === request.messageId,
		);
		if (!message) {
			return "missing";
		}
		message.finishes.push(request);
		message.lastErrorCode = request.code;
		if (request.outcome === "sent") {
			message.status = "sent";
			message.providerMessageId = request.providerMessageId;
		} else if (request.outcome === "retry") {
			message.status = message.attempts >= 5 ? "failed" : "queued";
			message.notBefore = new Date(
				request.at.getTime() + (request.retryAfterSeconds ?? 60) * 1000,
			);
		} else {
			message.status = request.outcome;
		}
		return message.status;
	}

	async recordDispatch(
		_at: Date,
		runtime: "edge" | "cli",
		secretNames: readonly string[],
		counts: Readonly<Record<string, number>>,
	): Promise<void> {
		this.dispatches.push({ runtime, secretNames, counts: { ...counts } });
	}

	async pendingLinkBots(
		_at: Date,
		tenantId: string | null,
	): Promise<PendingLinkBot[]> {
		const bots = new Map<string, ChannelKind>();
		for (const link of this.links) {
			if (!link.accepted && (tenantId === null || link.tenantId === tenantId)) {
				bots.set(link.secretName, link.kind);
			}
		}
		return [...bots.entries()].map(([secretName, kind]) => ({
			secretName,
			kind,
		}));
	}

	async takePollLease(
		secretName: string,
		_kind: ChannelKind,
		worker: string,
	): Promise<boolean> {
		const holder = this.leases.get(secretName);
		if (holder !== undefined && holder !== worker) {
			return false;
		}
		this.leases.set(secretName, worker);
		return true;
	}

	async releasePollLease(secretName: string, worker: string): Promise<void> {
		if (this.leases.get(secretName) === worker) {
			this.leases.delete(secretName);
		}
	}

	async pollCursor(secretName: string): Promise<number | null> {
		return this.cursors.get(secretName) ?? null;
	}

	async savePollState(
		secretName: string,
		_worker: string,
		cursor: number | null,
	): Promise<void> {
		this.cursors.set(secretName, cursor);
	}

	async completeChannelLink(
		kind: ChannelKind,
		secretName: string,
		code: string,
		address: string,
	): Promise<string | null> {
		const link = this.links.find(
			(candidate) =>
				candidate.kind === kind &&
				candidate.secretName === secretName &&
				candidate.code === code &&
				candidate.chatId === null,
		);
		if (!link) {
			return null;
		}
		link.chatId = address;
		return "channel-linked";
	}

	async acceptChannelLink(
		kind: ChannelKind,
		secretName: string,
		address: string,
	): Promise<string | null> {
		const link = this.links.find(
			(candidate) =>
				candidate.kind === kind &&
				candidate.secretName === secretName &&
				candidate.chatId === address &&
				!candidate.accepted,
		);
		if (!link) {
			return null;
		}
		link.accepted = true;
		return "channel-linked";
	}
}
