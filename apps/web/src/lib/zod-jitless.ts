type ZodGlobal = { __zod_globalConfig?: Record<string, unknown> };

const holder = globalThis as ZodGlobal;
holder.__zod_globalConfig = Object.assign(holder.__zod_globalConfig ?? {}, {
	jitless: true,
});
