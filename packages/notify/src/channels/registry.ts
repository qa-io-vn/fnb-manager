import { createBrevoAdapter } from "./brevo.js";
import { credentialKindOf } from "./secrets.js";
import type {
	ChannelAdapter,
	ChannelKind,
	ProviderId,
	ProviderLimits,
} from "./types.js";
import { createZaloBotAdapter } from "./zalo-bot.js";

const UNBUILT_LIMITS: ProviderLimits = {
	maxTextUnits: 1900,
	maxSubjectChars: null,
	supportsHtml: false,
	idempotent: false,
	minSpacingMs: 1100,
};

function unbuiltAdapter(
	provider: ProviderId,
	kind: ChannelKind,
): ChannelAdapter {
	return {
		provider,
		kind,
		available: false,
		limits: UNBUILT_LIMITS,
		async send() {
			return {
				kind: "failed",
				code: "provider_unavailable",
				scope: "message",
			};
		},
	};
}

export type AdapterRegistry = Readonly<Record<ProviderId, ChannelAdapter>>;

export function createAdapterRegistry(): AdapterRegistry {
	return {
		zalo_bot: createZaloBotAdapter(),
		telegram: unbuiltAdapter("telegram", "telegram"),
		brevo: createBrevoAdapter(),
		resend: unbuiltAdapter("resend", "email"),
		hmac_webhook: unbuiltAdapter("hmac_webhook", "webhook"),
	};
}

export function availableKinds(adapters: AdapterRegistry): Set<ChannelKind> {
	return new Set(
		Object.values(adapters)
			.filter((adapter) => adapter.available)
			.map((adapter) => adapter.kind),
	);
}

export function claimableSecretNames(
	secretNames: readonly string[],
	adapters: AdapterRegistry,
): string[] {
	const kinds = availableKinds(adapters);
	return secretNames.filter((name) => {
		const kind = credentialKindOf(name);
		return kind !== null && kinds.has(kind);
	});
}

export function pollingAdapterFor(
	kind: ChannelKind,
	adapters: AdapterRegistry,
): ChannelAdapter | null {
	const adapter = Object.values(adapters).find(
		(candidate) =>
			candidate.kind === kind &&
			candidate.available &&
			candidate.pollUpdates !== undefined,
	);
	return adapter ?? null;
}

export function availableProviders(adapters: AdapterRegistry): ProviderId[] {
	return Object.values(adapters)
		.filter((adapter) => adapter.available)
		.map((adapter) => adapter.provider);
}
