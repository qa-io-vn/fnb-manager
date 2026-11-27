import type { Plugin } from "vite";

/**
 * The content security policy of a counter build, written into index.html as a meta element (ADR-066): scripts only
 * from the app itself, network calls only to the app, the Supabase API and the sign-in function, images from the app,
 * data and blob addresses (QR codes, menu photos through the Supabase origin), no plugins, no other base, forms only
 * to the app. Styles allow inline attributes and the brand's style element (the theme is applied at start-up). A
 * dev server is left without it, because Vite's own client injects inline scripts.
 */

export function originOf(url: string | undefined): string | null {
	if (url === undefined || url.trim() === "") return null;
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

export function contentSecurityPolicy(
	origins: readonly (string | null)[],
): string {
	const connect = [
		"'self'",
		...new Set(origins.filter((origin): origin is string => origin !== null)),
	];
	return [
		"default-src 'self'",
		"script-src 'self'",
		`connect-src ${connect.join(" ")}`,
		`img-src 'self' data: blob: ${connect.slice(1).join(" ")}`.trim(),
		"style-src 'self' 'unsafe-inline'",
		"font-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"manifest-src 'self'",
		"worker-src 'self'",
	].join("; ");
}

export function counterCsp(): Plugin {
	let policy = "";
	return {
		name: "fnb-counter-csp",
		apply: "build",
		configResolved(config) {
			const env = config.env;
			policy = contentSecurityPolicy([
				originOf(env.VITE_SUPABASE_URL),
				originOf(env.VITE_COUNTER_SESSION_URL),
			]);
		},
		transformIndexHtml: {
			order: "post",
			handler() {
				return [
					{
						tag: "meta",
						attrs: { "http-equiv": "Content-Security-Policy", content: policy },
						injectTo: "head-prepend",
					},
				];
			},
		},
	};
}
