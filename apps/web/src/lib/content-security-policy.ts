export interface ContentSecurityPolicyOptions {
	readonly supabaseUrl?: string | undefined;
	readonly dev?: {
		readonly inlineScriptHashes: readonly string[];
	};
}

export function apiOrigin(supabaseUrl: string | undefined): string | null {
	const trimmed = supabaseUrl?.trim() ?? "";
	if (trimmed === "") return null;
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error("VITE_SUPABASE_URL is not a URL");
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error("VITE_SUPABASE_URL must use https or http");
	}
	if (parsed.username !== "" || parsed.password !== "") {
		throw new Error("VITE_SUPABASE_URL must not carry credentials");
	}
	return parsed.origin;
}

export function contentSecurityPolicy(
	options: ContentSecurityPolicyOptions = {},
): string {
	const origin = apiOrigin(options.supabaseUrl);
	const dev = options.dev;
	const scriptSources = [
		"'self'",
		...(dev?.inlineScriptHashes.map((hash) => `'sha256-${hash}'`) ?? []),
	];
	const connectSources = [
		"'self'",
		...(origin === null ? [] : [origin]),
		...(dev ? ["ws://127.0.0.1:*", "ws://localhost:*"] : []),
	];
	const styleSources = dev ? ["'self'", "'unsafe-inline'"] : ["'self'"];
	const directives: [string, readonly string[]][] = [
		["default-src", ["'self'"]],
		["script-src", scriptSources],
		["style-src", styleSources],
		["img-src", ["'self'", "data:", "blob:"]],
		["font-src", ["'self'"]],
		["connect-src", connectSources],
		["worker-src", ["'self'"]],
		["manifest-src", ["'self'"]],
		["object-src", ["'none'"]],
		["base-uri", ["'self'"]],
		["form-action", ["'self'"]],
	];
	return directives
		.map(([name, sources]) => `${name} ${sources.join(" ")}`)
		.join("; ");
}
