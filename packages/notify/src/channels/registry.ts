import { createBrevoAdapter } from "./brevo.js";
import { createResendAdapter } from "./resend.js";
import { credentialKindOf } from "./secrets.js";
import { createTelegramAdapter } from "./telegram.js";
import type { ChannelAdapter, ChannelKind, ProviderId } from "./types.js";
import { createWebhookAdapter } from "./webhook.js";
import { createZaloBotAdapter } from "./zalo-bot.js";

export type AdapterRegistry = Readonly<Record<ProviderId, ChannelAdapter>>;

export function createAdapterRegistry(): AdapterRegistry {
	return {
		zalo_bot: createZaloBotAdapter(),
		telegram: createTelegramAdapter(),
		brevo: createBrevoAdapter(),
		resend: createResendAdapter(),
		hmac_webhook: createWebhookAdapter(),
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
