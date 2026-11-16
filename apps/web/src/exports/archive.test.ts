import * as fflate from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
	createArchiveWriter,
	GUIDE_PATH,
	generatedAtOf,
	MANIFEST_PATH,
} from "./archive";
import { zipEntries } from "./testing/zip-entries";

const DOS_DATE_1980_01_01 = (0 << 9) | (1 << 5) | 1;
const encoder = new TextEncoder();
const originalZone = process.env.TZ;

async function sampleArchive(): Promise<Uint8Array> {
	const writer = createArchiveWriter(fflate);
	writer.add(
		"2026-10/tong-hop-ngay.csv",
		encoder.encode("\u{FEFF}a,b\r\n1,2\r\n"),
	);
	writer.add(
		"2026-10/S1/hoa-don.csv",
		encoder.encode("\u{FEFF}id\r\nHóa đơn\r\n"),
	);
	writer.add("2026-10/S1/ca.csv", encoder.encode("\u{FEFF}id\r\n"));
	const chunks = await writer.finish(
		encoder.encode('{"format":"fnb-export-manifest"}\n'),
		encoder.encode("ĐỌC TRƯỚC\r\n"),
	);
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

describe("the export archive", () => {
	afterEach(() => {
		process.env.TZ = originalZone;
	});

	it("puts the manifest and the guide first, then the files in the order added", async () => {
		const bytes = await sampleArchive();
		const entries = zipEntries(bytes);
		expect(entries.map((entry) => entry.name)).toEqual([
			MANIFEST_PATH,
			GUIDE_PATH,
			"2026-10/tong-hop-ngay.csv",
			"2026-10/S1/hoa-don.csv",
			"2026-10/S1/ca.csv",
		]);
		const offsets = entries.map((entry) => entry.offset);
		expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
		for (const entry of entries) {
			expect(entry.method, entry.name).toBe(8);
			expect(entry.dosDate, entry.name).toBe(DOS_DATE_1980_01_01);
			expect(entry.dosTime, entry.name).toBe(0);
		}
		const files = fflate.unzipSync(bytes);
		expect(
			new TextDecoder("utf-8", { ignoreBOM: true }).decode(
				files["2026-10/S1/hoa-don.csv"],
			),
		).toBe("\u{FEFF}id\r\nHóa đơn\r\n");
	});

	it("writes the same bytes in two time zones", async () => {
		process.env.TZ = "UTC";
		const utcOffset = new Date(2026, 0, 1).getTimezoneOffset();
		const first = await sampleArchive();
		process.env.TZ = "America/Los_Angeles";
		expect(new Date(2026, 0, 1).getTimezoneOffset()).not.toBe(utcOffset);
		const second = await sampleArchive();
		expect(second).toEqual(first);
	});

	it("refuses paths that are not printable ASCII", () => {
		const writer = createArchiveWriter(fflate);
		expect(() => writer.add("2026-10/Hóa đơn.csv", new Uint8Array())).toThrow(
			RangeError,
		);
		expect(() => writer.add("2026-10/a b.csv", new Uint8Array())).toThrow(
			RangeError,
		);
		writer.abort();
	});

	it("stamps generated_at in UTC to the second", () => {
		expect(generatedAtOf(new Date("2026-11-12T03:00:00.987Z"))).toBe(
			"2026-11-12T03:00:00Z",
		);
	});
});
