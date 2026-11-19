import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	type Listing,
	loadListings,
	SYNTHETIC_LISTING_CONFIGS,
	selectListing,
} from "@fnb/zalo-mini/listing";
import { STORE_CODE_PATTERN } from "@fnb/zalo-mini/loyalty";
import { miniAppLink } from "../src/data/link";
import {
	buildStandee,
	printablePage,
	STANDEE_HEIGHT_MM,
	STANDEE_WIDTH_MM,
	type Standee,
	type StandeeStore,
} from "./standee";

export const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..", "..");

const usage = [
	"Usage:",
	"  standees --brand <key> [--config <file>]... [--store <code>[=<name>]]... [--link-base <url>] [--out <folder>] [--pdf]",
	"",
	"Writes one printable A6 standee per store (SVG, and PDF with --pdf) whose QR opens that store's page:",
	"  https://zalo.me/s/<mini app id>/?store=<code>&src=standee",
	"--link-base replaces https://zalo.me/s/<mini app id>/ (a Development link from zmp deploy, or the local loop's address).",
	"The folder must be outside the repository; by default it is <temp>/fnb-standees/<brand>.",
].join("\n");

export class StandeeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StandeeError";
	}
}

function callerPath(path: string): string {
	return isAbsolute(path)
		? path
		: resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

export function insideRepository(
	folder: string,
	root = REPOSITORY_ROOT,
): boolean {
	const path = relative(root, resolve(folder));
	return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function storesFrom(
	listing: Listing,
	requested: readonly string[],
): StandeeStore[] {
	if (requested.length === 0) {
		if (listing.stores.length === 0) {
			throw new StandeeError(
				`${listing.brandKey} lists no stores; name them with --store <code>[=<name>]`,
			);
		}
		return [...listing.stores];
	}
	return requested.map((entry) => {
		const split = entry.indexOf("=");
		const code = (split < 0 ? entry : entry.slice(0, split)).trim();
		if (!STORE_CODE_PATTERN.test(code)) {
			throw new StandeeError(
				`${code} is not a store link key: 1 to 64 of A-Z, a-z, 0-9, ., _ and -`,
			);
		}
		const given = split < 0 ? "" : entry.slice(split + 1).trim();
		const known = listing.stores.find((store) => store.code === code);
		return { code, name: given || known?.name || code };
	});
}

export function linkBaseFor(
	listing: Listing,
	override: string | undefined,
): string {
	if (override !== undefined) return override;
	if (listing.miniAppId === null) {
		throw new StandeeError(
			`the ${listing.brandKey} customer Mini App has no id yet; add it to the configuration or give --link-base`,
		);
	}
	return miniAppLink(listing.miniAppId);
}

export function standeesFor(
	listing: Listing,
	stores: readonly StandeeStore[],
	linkBase: string,
): Standee[] {
	const color = listing.headerColor;
	if (color === null || listing.textColor === null) {
		throw new StandeeError(
			`${listing.brandKey} needs header_color_light and text_color_light for the standee's band`,
		);
	}
	return stores.map((store) =>
		buildStandee(
			{
				displayName: listing.headerTitle ?? listing.name,
				headerColor: color,
				textColor: listing.textColor ?? "white",
			},
			store,
			linkBase,
		),
	);
}

async function writePdfs(folder: string, standees: readonly Standee[]) {
	const { chromium } = await import("@playwright/test");
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		for (const standee of standees) {
			await page.setContent(printablePage(standee.svg), { waitUntil: "load" });
			await page.pdf({
				path: join(folder, `${standee.fileName}.pdf`),
				width: `${STANDEE_WIDTH_MM}mm`,
				height: `${STANDEE_HEIGHT_MM}mm`,
				printBackground: true,
				pageRanges: "1",
			});
		}
	} finally {
		await browser.close();
	}
}

export async function run(argv: readonly string[]): Promise<number> {
	const { values } = parseArgs({
		args: [...argv],
		strict: true,
		options: {
			brand: { type: "string" },
			config: { type: "string", multiple: true },
			store: { type: "string", multiple: true },
			"link-base": { type: "string" },
			out: { type: "string" },
			pdf: { type: "boolean", default: false },
			help: { type: "boolean", default: false },
		},
	});
	if (values.help || values.brand === undefined) {
		console.log(usage);
		return values.help ? 0 : 2;
	}
	const listing = selectListing(
		loadListings(
			values.config === undefined
				? SYNTHETIC_LISTING_CONFIGS
				: values.config.map(callerPath),
		),
		values.brand,
	);
	const folder =
		values.out === undefined
			? join(tmpdir(), "fnb-standees", values.brand)
			: callerPath(values.out);
	if (insideRepository(folder)) {
		throw new StandeeError(
			`${folder} is inside the repository; write the standees to a folder outside it`,
		);
	}
	const standees = standeesFor(
		listing,
		storesFrom(listing, values.store ?? []),
		linkBaseFor(listing, values["link-base"]),
	);
	mkdirSync(folder, { recursive: true });
	for (const standee of standees) {
		writeFileSync(join(folder, `${standee.fileName}.svg`), standee.svg);
	}
	if (values.pdf) await writePdfs(folder, standees);
	console.log(
		`standees: ${standees.length} for ${listing.brandKey} in ${folder}`,
	);
	for (const standee of standees) {
		const files = values.pdf ? ".svg and .pdf" : ".svg";
		console.log(
			`  ${standee.fileName}${files}  ${standee.store.name}  ${standee.link}`,
		);
	}
	return 0;
}

if (
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === resolve(import.meta.filename)
) {
	run(process.argv.slice(2)).then(
		(code) => {
			process.exitCode = code;
		},
		(error: unknown) => {
			if (
				error instanceof TypeError &&
				String((error as { code?: unknown }).code).startsWith("ERR_PARSE_ARGS")
			) {
				console.error(`standees: ${error.message}`);
				console.error(usage);
				process.exitCode = 2;
				return;
			}
			if (error instanceof Error) {
				console.error(`standees: ${error.message}`);
				process.exitCode = 1;
				return;
			}
			throw error;
		},
	);
}
