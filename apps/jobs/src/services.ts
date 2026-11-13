import type { RunnerDatabase } from "@fnb/runner";
import { PostgresRunnerDatabase } from "@fnb/runner/postgres";
import type { SyncRepository } from "@fnb/sync";
import {
	createPostgresClient,
	PostgresSyncRepository,
} from "@fnb/sync/postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";
import {
	type DatabaseSetting,
	databaseSetting,
	supabaseApiSetting,
} from "./config/config.js";
import type { Environment } from "./config/env-file.js";

export interface Database {
	sql: Sql;
	repository: SyncRepository;
	runner: RunnerDatabase;
	setting: DatabaseSetting;
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
				runner: new PostgresRunnerDatabase(sql),
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
