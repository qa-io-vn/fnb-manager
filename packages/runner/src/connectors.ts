import { ConnectorRegistry, type PosConnector } from "@fnb/connector-core";
import {
	type FetchLike,
	iposConnectorFactory,
	type TokenStore,
	toStoredToken,
} from "@fnb/connector-ipos";
import { mockConnectorFactory } from "@fnb/connector-mock";
import type { SyncRepository } from "@fnb/sync";
import { AccountConfigError, type AccountEntry } from "./accounts.js";

export type RunnerEnvironment = Readonly<Record<string, string | undefined>>;

export const IPOS_APP_KEY_VARIABLE = "IPOS_APP_KEY";

export interface ConnectorSession {
	connector: PosConnector;
	httpRequests: () => number;
}

export function createConnectorRegistry(): ConnectorRegistry {
	return new ConnectorRegistry()
		.register(iposConnectorFactory)
		.register(mockConnectorFactory);
}

export function credentialsFor(
	entry: AccountEntry,
	environment: RunnerEnvironment,
): unknown {
	if (entry.connector === "mock") {
		return {
			seed: entry.seed ?? 1,
			...(entry.storeCount === undefined
				? {}
				: { storeCount: entry.storeCount }),
			...(entry.rejectLogin === true ? { rejectLogin: true } : {}),
		};
	}
	const appAccessToken =
		entry.appAccessToken ?? (environment[IPOS_APP_KEY_VARIABLE] || undefined);
	if (!appAccessToken) {
		throw new AccountConfigError(
			`an ipos-fabi account needs the iPOS application key: set ${IPOS_APP_KEY_VARIABLE} or add appAccessToken to its entry`,
		);
	}
	return { email: entry.email, password: entry.password, appAccessToken };
}

export function repositoryTokenStore(
	repository: Pick<SyncRepository, "readToken" | "writeToken">,
	accountId: string,
): TokenStore {
	return {
		async get() {
			const stored = await repository.readToken(accountId);
			if (!stored) {
				return null;
			}
			try {
				return toStoredToken(stored.token);
			} catch {
				return null;
			}
		},
		async set(_key, token) {
			await repository.writeToken(accountId, {
				token: token.token,
				expires_at: new Date(token.expiresAt).toISOString(),
			});
		},
	};
}

export function readOnlyTokenStore(
	repository: Pick<SyncRepository, "readToken" | "writeToken">,
	accountId: string,
): TokenStore {
	const stored = repositoryTokenStore(repository, accountId);
	return {
		get: stored.get,
		async set() {},
	};
}

export interface ConnectOptions {
	tokenStore?: TokenStore;
	fetch?: FetchLike;
}

export async function connectAccount(
	entry: AccountEntry,
	environment: RunnerEnvironment,
	options: ConnectOptions = {},
): Promise<ConnectorSession> {
	let requests = 0;
	const transport = options.fetch ?? ((input, init) => fetch(input, init));
	const countingFetch: FetchLike = (input, init) => {
		requests += 1;
		return transport(input, init);
	};
	const connectorOptions =
		entry.connector === "ipos-fabi"
			? {
					fetch: countingFetch,
					...(options.tokenStore ? { tokenStore: options.tokenStore } : {}),
				}
			: {};
	const connector = createConnectorRegistry().create(
		entry.connector,
		connectorOptions,
	);
	await connector.authenticate(credentialsFor(entry, environment));
	return { connector, httpRequests: () => requests };
}
