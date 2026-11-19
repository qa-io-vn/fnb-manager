import postgres from "postgres";
import type { ZaloEnvironment } from "../settings.js";
import { localStackFrom } from "./environment.js";
import type { LocalLoopIo } from "./loop.js";
import {
	LOCAL_LOOP_DEFAULTS,
	LocalLoopError,
	type LocalLoopOptions,
} from "./options.js";
import {
	isSeedableTenant,
	type ManagerSetup,
	SIMULATED_TENANT,
	seedSyntheticBrand,
	seedSyntheticManager,
} from "./seed.js";

export function staffDevCommand(
	tenant: string,
	brand: string,
	manager: Pick<ManagerSetup, "email" | "mockUser">,
): string {
	return [
		"pnpm zalo:dev",
		`--tenant ${tenant}`,
		...(brand === LOCAL_LOOP_DEFAULTS.brand ? [] : [`--brand ${brand}`]),
		`--member ${manager.email}`,
		`--mock-user ${manager.mockUser}`,
	].join(" ");
}

export function staffSetupLines(
	options: Pick<LocalLoopOptions, "tenant" | "brand">,
	brandSeeded: boolean,
	manager: ManagerSetup,
): string[] {
	return [
		`zalo:dev setup-staff: ${options.tenant} on the local stack`,
		brandSeeded
			? `  ${options.brand}: seeded a synthetic brand over its stores, a mock Zalo App, OA and the two Mini Apps`
			: `  ${options.brand}: already seeded`,
		`  manager login: ${manager.email}, manager of ${manager.storeNames.join(" and ")} (${manager.created ? "created" : "already there"})`,
		manager.password === null
			? "  password: unchanged, printed when the login was created; pass --new-password for a new one"
			: `  password: ${manager.password}`,
		...(manager.password === null
			? []
			: [
					"    shown once: it is kept nowhere but as a hash in the local stack's auth.users; it also signs in to the web app on the local stack",
				]),
		"  no staff roster row: a member who is not on the roster signs in after the one-time binding code, without the staff notice",
		...(manager.mockUserBoundElsewhere
			? [
					`  ${manager.mockUser} is bound to another login of ${options.tenant}; add another --mock-user mock-… to the command below`,
				]
			: []),
		"open the staff app as this manager:",
		`  ${staffDevCommand(options.tenant, options.brand, manager)}`,
	];
}

export async function setUpLocalStaff(
	options: LocalLoopOptions,
	environment: ZaloEnvironment,
	io: LocalLoopIo,
): Promise<ManagerSetup> {
	if (!isSeedableTenant(options.tenant)) {
		throw new LocalLoopError(
			`setup-staff makes a synthetic manager on a synthetic tenant only (${SIMULATED_TENANT} or zalo-it-…); ${options.tenant} is refused`,
		);
	}
	const stack = localStackFrom(environment);
	const sql = postgres(stack.databaseUrl, {
		max: 1,
		connect_timeout: 10,
		onnotice: () => undefined,
	});
	try {
		const brandSeeded = await seedSyntheticBrand(
			sql,
			options.tenant,
			options.brand,
		);
		const manager = await seedSyntheticManager(
			sql,
			options.tenant,
			options.brand,
			{ newPassword: options.newPassword === true },
		);
		for (const line of staffSetupLines(options, brandSeeded, manager)) {
			io.line(line);
		}
		return manager;
	} finally {
		await sql.end({ timeout: 5 });
	}
}
