import type { PosConnector } from "@fnb/connector-core";
import { ConnectorRegistry } from "@fnb/connector-core";
import {
	type FetchLike,
	iposConnectorFactory,
	type TokenStore,
	toStoredToken,
} from "@fnb/connector-ipos";
import { mockConnectorFactory } from "@fnb/connector-mock";
import type { SyncRepository } from "@fnb/sync";
import {
	createPostgresClient,
	PostgresSyncRepository,
} from "@fnb/sync/postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";
import type { AccountEntry } from "./config/accounts.js";
import {
	type DatabaseSetting,
	databaseSetting,
	iposAppKey,
	supabaseApiSetting,
} from "./config/config.js";
import type { Environment } from "./config/env-file.js";
import { ConfigError } from "./config/errors.js";

export interface Database {
	sql: Sql;
	repository: SyncRepository;
	setting: DatabaseSetting;
}

export interface ConnectorSession {
	connector: PosConnector;
	httpRequests: () => number;
}

export function createRegistry(): ConnectorRegistry {
	return new ConnectorRegistry()
		.register(iposConnectorFactory)
		.register(mockConnectorFactory);
}

export function credentialsFor(
	entry: AccountEntry,
	environment: Environment,
): unknown {
	if (entry.connector === "mock") {
		return {
			seed: entry.seed ?? 1,
			...(entry.storeCount === undefined
				? {}
				: { storeCount: entry.storeCount }),
		};
	}
	const appAccessToken = entry.appAccessToken ?? iposAppKey(environment);
	if (!appAccessToken) {
		throw new ConfigError(
			"an ipos-fabi account needs the iPOS application key: set IPOS_APP_KEY or add appAccessToken to its entry",
		);
	}
	return { email: entry.email, password: entry.password, appAccessToken };
}

export function repositoryTokenStore(
	repository: SyncRepository,
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
	repository: SyncRepository,
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
}

export async function connectAccount(
	entry: AccountEntry,
	environment: Environment,
	options: ConnectOptions = {},
): Promise<ConnectorSession> {
	let requests = 0;
	const countingFetch: FetchLike = (input, init) => {
		requests += 1;
		return fetch(input, init);
	};
	const connectorOptions =
		entry.connector === "ipos-fabi"
			? {
					fetch: countingFetch,
					...(options.tokenStore ? { tokenStore: options.tokenStore } : {}),
				}
			: {};
	const connector = createRegistry().create(entry.connector, connectorOptions);
	await connector.authenticate(credentialsFor(entry, environment));
	return { connector, httpRequests: () => requests };
}

export class Services {
	private readonly environment: Environment;
	private database: Database | null = null;

	constructor(environment: Environment) {
		this.environment = environment;
	}

	db(): Database {
		if (!this.database) {
			const setting = databaseSetting(this.environment);
			const sql = createPostgresClient(setting.url, {
				applicationName: "fnb-cli",
			});
			this.database = {
				sql,
				repository: new PostgresSyncRepository(sql),
				setting,
			};
		}
		return this.database;
	}

	supabaseAdmin(): SupabaseClient {
		const setting = supabaseApiSetting(this.environment);
		return createClient(setting.url, setting.secretKey, {
			auth: { autoRefreshToken: false, persistSession: false },
		});
	}

	async close(): Promise<void> {
		if (this.database) {
			await this.database.sql.end({ timeout: 5 });
			this.database = null;
		}
	}
}
