import { createHash } from "node:crypto";
import { buildGoldenPack, demoSource } from "./demo.js";

const built = await buildGoldenPack(demoSource());
const options = Intl.DateTimeFormat().resolvedOptions();
process.stdout.write(
	JSON.stringify({
		timeZone: options.timeZone,
		offset: new Date(Date.UTC(2026, 10, 12)).getTimezoneOffset(),
		lang: process.env.LANG ?? null,
		sha256: createHash("sha256").update(built.text).digest("hex"),
	}),
);
