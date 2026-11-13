import type {
	ChannelKind,
	MessageKind,
	ProviderId,
} from "../channels/types.js";
import {
	CHANNEL_WORDS,
	NOTICE_TEMPLATE,
	PROVIDER_WORDS,
} from "../messages/notice.js";
import { renderAlert } from "./alert.js";
import { formatClockTime, formatViDate, localIsoDate } from "./format.js";
import { fillTemplate, message, TemplateError } from "./template.js";

export interface QueuedMessageFacts {
	readonly kind: MessageKind;
	readonly channelKind: ChannelKind;
	readonly provider: ProviderId;
	readonly channelLabel: string;
	readonly readerTimezone: string;
	readonly tenantName: string;
	readonly at: Date;
	readonly ruleKey?: string | null;
	readonly templateRef?: string | null;
	readonly params?: Readonly<Record<string, unknown>>;
	readonly storeName?: string | null;
	readonly accountName?: string | null;
}

export interface RenderedText {
	readonly title: string | null;
	readonly text: string;
}

function channelWord(kind: ChannelKind): string {
	return kind in CHANNEL_WORDS
		? CHANNEL_WORDS[kind as keyof typeof CHANNEL_WORDS]
		: kind;
}

export interface NoticeFacts {
	readonly tenantName: string;
	readonly channelKind: ChannelKind;
	readonly provider: ProviderId;
}

export function renderNotice(facts: NoticeFacts): string {
	return fillTemplate(NOTICE_TEMPLATE, {
		tenant: facts.tenantName,
		kênh: channelWord(facts.channelKind),
		"nhà cung cấp": PROVIDER_WORDS[facts.provider],
	});
}

export function renderLinkCodeEmail(
	facts: NoticeFacts & { readonly code: string },
): RenderedText {
	return {
		title: message("link_code.subject"),
		text: message("link_code.body", {
			notice: renderNotice(facts),
			code: facts.code,
		}),
	};
}

export function renderHandover(
	facts: NoticeFacts & { readonly code: string; readonly botName: string },
): string {
	return message("link.handover", {
		notice: renderNotice(facts),
		code: facts.code,
		bot: facts.botName,
	});
}

export function renderQueuedMessage(facts: QueuedMessageFacts): RenderedText {
	switch (facts.kind) {
		case "test":
			return {
				title: message("test.subject"),
				text: message("test.body", {
					label: facts.channelLabel,
					time: formatClockTime(facts.at, facts.readerTimezone),
					date: formatViDate(localIsoDate(facts.at, facts.readerTimezone)),
				}),
			};
		case "link_notice":
			return {
				title: message("link_notice.subject"),
				text: message("link_notice.body", { notice: renderNotice(facts) }),
			};
		case "link_confirmation":
			return {
				title: message("link_confirmation.subject"),
				text: message("link_confirmation.body", { tenant: facts.tenantName }),
			};
		case "alert":
		case "alert_reminder":
		case "alert_resolved":
			return renderAlert({
				kind: facts.kind,
				ruleKey: facts.ruleKey ?? null,
				templateRef: facts.templateRef ?? null,
				params: facts.params ?? {},
				storeName: facts.storeName ?? null,
				accountName: facts.accountName ?? null,
				readerTimezone: facts.readerTimezone,
				at: facts.at,
			});
		default:
			throw new TemplateError(
				"render_unavailable",
				`no renderer for a ${facts.kind} message without a stored body`,
			);
	}
}
