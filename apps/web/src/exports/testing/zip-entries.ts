export interface ZipEntry {
	readonly name: string;
	readonly method: number;
	readonly dosTime: number;
	readonly dosDate: number;
	readonly offset: number;
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;

export function zipEntries(bytes: Uint8Array): ZipEntry[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let end = bytes.length - 22;
	while (end >= 0 && view.getUint32(end, true) !== END_OF_DIRECTORY) end -= 1;
	if (end < 0) throw new Error("not a zip archive");
	const count = view.getUint16(end + 10, true);
	let cursor = view.getUint32(end + 16, true);
	const entries: ZipEntry[] = [];
	for (let index = 0; index < count; index += 1) {
		if (view.getUint32(cursor, true) !== DIRECTORY_ENTRY) {
			throw new Error("broken central directory");
		}
		const nameLength = view.getUint16(cursor + 28, true);
		const extraLength = view.getUint16(cursor + 30, true);
		const commentLength = view.getUint16(cursor + 32, true);
		entries.push({
			method: view.getUint16(cursor + 10, true),
			dosTime: view.getUint16(cursor + 12, true),
			dosDate: view.getUint16(cursor + 14, true),
			offset: view.getUint32(cursor + 42, true),
			name: new TextDecoder().decode(
				bytes.subarray(cursor + 46, cursor + 46 + nameLength),
			),
		});
		cursor += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}
