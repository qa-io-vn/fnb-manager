#!/usr/bin/env node
// The real sign-in check (G-109): one customer sign-in against the live cloud with a real Zalo user token, then the
// home it opens on. The automated suites run on a stand-in Zalo whose token and App secret always match, so a wrong
// secret in the cloud's function secrets is invisible to them; this check is the one that sees it. Run it after any
// change to a Zalo App secret, to the zalo-session function or to a brand's Mini App rows, before a version is called
// ready.
//
//   node scripts/zalo-sign-in-check.mjs --token-file <file> [--brand brand-1]
//
// The token: Zalo for Developers > Tools > API Explorer, the brand's Zalo App, "User Access Token", saved to a file
// (never typed on the command line, so it stays out of the shell history); delete the file afterwards. The cloud
// address and the publishable key come from SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or their VITE_ names); both
// are public. Only status codes, counts and a diagnosis are printed: never the token, a session, the Zalo user id or
// a name. Exit code 0 when the sign-in and the home both answer.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const GRAPH_ME = "https://graph.zalo.me/v2.0/me?fields=id";
export const BRAND_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const PROOF_INVALID = 453;

export class UsageError extends Error {}

export function parseArguments(argv) {
	let tokenFile = null;
	let brand = "brand-1";
	for (let index = 0; index < argv.length; index += 1) {
		const name = argv[index];
		const value = argv[index + 1];
		if (name === "--token-file" && value !== undefined) {
			tokenFile = value;
			index += 1;
		} else if (name === "--brand" && value !== undefined) {
			brand = value;
			index += 1;
		} else if (name === "--token") {
			throw new UsageError(
				"pass the token in a file with --token-file, never on the command line",
			);
		} else {
			throw new UsageError(`unknown argument ${name}`);
		}
	}
	if (tokenFile === null) throw new UsageError("--token-file is required");
	if (!BRAND_PATTERN.test(brand))
		throw new UsageError("--brand must be a brand key such as brand-1");
	return { tokenFile, brand };
}

export function cloudSettings(env) {
	const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "")
		.trim()
		.replace(/\/+$/, "");
	const key = (
		env.SUPABASE_PUBLISHABLE_KEY ??
		env.VITE_SUPABASE_PUBLISHABLE_KEY ??
		""
	).trim();
	if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))
		throw new UsageError(
			"SUPABASE_URL must be the cloud project's https://<ref>.supabase.co",
		);
	if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
		throw new UsageError(
			"SUPABASE_PUBLISHABLE_KEY must be the project's publishable key",
		);
	return { url, key };
}

async function jsonOf(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

const codeOf = (body) =>
	body !== null && typeof body === "object"
		? (body.error ?? body.code ?? null)
		: null;

/** Counts and flags of a customer_home answer; never a name, an address or a text. */
export function homeSummary(home) {
	const legal = home?.legal ?? {};
	return {
		programme: home?.programme != null,
		stores: Array.isArray(home?.stores) ? home.stores.length : 0,
		privacyNotice: legal.policy_version != null,
		documents: Array.isArray(legal.documents) ? legal.documents.length : 0,
		menu: Array.isArray(home?.menu) ? home.menu.length : 0,
	};
}

/** What the answers mean, in plain words, most important first. */
export function diagnose(result) {
	const lines = [];
	if (result.zalo !== null && result.zalo !== 0) {
		lines.push(
			`Zalo refuses the token itself (error ${result.zalo}): get a fresh User Access Token and run again.`,
		);
		return lines;
	}
	if (result.session.status !== 200) {
		if (
			result.session.status === 401 &&
			result.session.code === "zalo_token_refused" &&
			result.zalo === 0
		) {
			lines.push(
				"Zalo accepts the token but the cloud refuses it. Read the Graph error in the zalo-session log (Edge Functions > zalo-session > Logs): -501 means Zalo refused the cloud server, which it does outside Vietnam, so start the relay (pnpm zalo:relay, ADR-057); 453 means the App secret stored for the brand (ZALO_APP_SECRET_<BRAND> in the function secrets) does not match the brand's Zalo App, so copy the key from the Zalo App's settings and save it again.",
			);
		} else if (
			result.session.status === 502 &&
			result.session.code === "zalo_unavailable"
		) {
			lines.push(
				"The cloud could not reach Zalo through the relay: check that pnpm zalo:relay is running and says it announced itself (ADR-057).",
			);
		} else if (result.session.code === "unknown_brand") {
			lines.push(
				"The cloud has no Zalo App for this brand key: check the zalo_apps row.",
			);
		} else if (result.session.code === "not_configured") {
			lines.push(
				"The cloud function is not configured: the App secret named by the zalo_apps row is missing.",
			);
		} else {
			lines.push(
				`The sign-in failed: ${result.session.status} ${result.session.code ?? "(no code)"}.`,
			);
		}
		return lines;
	}
	if (result.home === null) return lines;
	if (result.home.status !== 200) {
		lines.push(
			`Signed in, but the home failed: ${result.home.status} ${result.home.code ?? "(no code)"}.`,
		);
		return lines;
	}
	const summary = result.home.summary;
	lines.push("Signed in and the home answered.");
	if (!summary.programme)
		lines.push(
			"No loyalty programme is open: the home says the programme is coming soon.",
		);
	if (summary.stores === 0)
		lines.push(
			"No store is listed for the brand's Zalo App (the brand's store list is empty): the home shows no store.",
		);
	if (!summary.privacyNotice)
		lines.push("No privacy notice is published: joining waits until one is.");
	return lines;
}

/** Runs the check; every answer is reduced to a status, a code or a count before it leaves this function. */
export async function signInCheck({ fetch, token, url, key, brand }) {
	const zaloAnswer = await jsonOf(
		await fetch(GRAPH_ME, { headers: { access_token: token } }),
	);
	const zalo =
		zaloAnswer !== null && Number.isInteger(zaloAnswer.error)
			? zaloAnswer.error
			: null;
	const sessionResponse = await fetch(`${url}/functions/v1/zalo-session`, {
		method: "POST",
		headers: { "content-type": "application/json", apikey: key },
		body: JSON.stringify({ kind: "customer", access_token: token, brand }),
	});
	const sessionBody = await jsonOf(sessionResponse);
	const session = {
		status: sessionResponse.status,
		code: sessionResponse.ok ? null : codeOf(sessionBody),
		member: sessionResponse.ok
			? sessionBody?.customer?.customer_id != null
			: null,
	};
	let home = null;
	const access = sessionResponse.ok ? sessionBody?.access_token : undefined;
	if (typeof access === "string" && access !== "") {
		const homeResponse = await fetch(`${url}/rest/v1/rpc/customer_home`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				apikey: key,
				authorization: `Bearer ${access}`,
			},
			body: "{}",
		});
		const homeBody = await jsonOf(homeResponse);
		home = {
			status: homeResponse.status,
			code: homeResponse.ok ? null : codeOf(homeBody),
			summary: homeResponse.ok ? homeSummary(homeBody) : null,
		};
	}
	const result = { zalo, session, home };
	return { ...result, diagnosis: diagnose(result) };
}

export function report(result) {
	const lines = [
		`zalo token: ${result.zalo === 0 ? "valid" : result.zalo === null ? "no answer" : `refused (error ${result.zalo})`}`,
		`sign-in: ${result.session.status}${result.session.code === null ? "" : ` ${result.session.code}`}${result.session.member === null ? "" : result.session.member ? " (member)" : " (visitor)"}`,
	];
	if (result.home !== null) {
		lines.push(
			`home: ${result.home.status}${result.home.code === null ? "" : ` ${result.home.code}`}${result.home.summary === null ? "" : ` programme ${result.home.summary.programme ? "open" : "none"}, ${result.home.summary.stores} stores, privacy notice ${result.home.summary.privacyNotice ? "published" : "missing"}, ${result.home.summary.documents} documents, ${result.home.summary.menu} menu items`}`,
		);
	}
	return [...lines, ...result.diagnosis];
}

export async function main(argv, env, io) {
	let options;
	let cloud;
	try {
		options = parseArguments(argv);
		cloud = cloudSettings(env);
	} catch (error) {
		if (error instanceof UsageError) {
			io.error(error.message);
			io.error(
				"usage: node scripts/zalo-sign-in-check.mjs --token-file <file> [--brand brand-1]",
			);
			return 2;
		}
		throw error;
	}
	const token = io.readFile(options.tokenFile).trim();
	if (token === "") {
		io.error("the token file is empty");
		return 2;
	}
	const result = await signInCheck({
		fetch: io.fetch,
		token,
		url: cloud.url,
		key: cloud.key,
		brand: options.brand,
	});
	for (const line of report(result)) io.log(line);
	return result.session.status === 200 && result.home?.status === 200 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	process.exitCode = await main(process.argv.slice(2), process.env, {
		fetch: (input, init) => fetch(input, init),
		readFile: (path) => readFileSync(path, "utf8"),
		log: (line) => console.log(line),
		error: (line) => console.error(line),
	});
}
