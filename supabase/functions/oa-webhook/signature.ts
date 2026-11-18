export const SIGNATURE_HEADER = "x-zevent-signature";

export type SignatureMatch = "raw" | "compact";
export type SignatureOutcome = SignatureMatch | "mismatch" | "missing";

export interface OaEvent {
	readonly appId: string;
	readonly oaId: string;
	readonly eventName: string;
	readonly userId: string | null;
	readonly timestamp: string;
	readonly occurredAt: Date | null;
	readonly messageId: string | null;
}

export interface SignatureInput {
	readonly header: string | null;
	readonly appId: string;
	readonly raw: string;
	readonly timestamp: string;
	readonly secret: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;
const TIMESTAMP_PATTERN = /^[0-9]{1,16}$/;
const MESSAGE_ID_MAX_LENGTH = 128;
const MAC_PATTERN = /^(?:mac=)?([0-9a-f]{64})$/i;
const OA_SENDER_PREFIX = "oa_send_";
const EARLIEST_EVENT_MS = Date.UTC(2015, 0, 1);

function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function idOf(value: unknown): string | null {
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
		return String(value);
	}
	return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

function timestampOf(value: unknown): string {
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
		return String(value);
	}
	return typeof value === "string" && TIMESTAMP_PATTERN.test(value)
		? value
		: "";
}

function occurredAtOf(timestamp: string): Date | null {
	if (timestamp === "") {
		return null;
	}
	const milliseconds = Number(timestamp);
	return milliseconds >= EARLIEST_EVENT_MS ? new Date(milliseconds) : null;
}

function messageIdOf(body: Readonly<Record<string, unknown>>): string | null {
	const id = recordOf(body.message)?.msg_id;
	if (typeof id === "number" && Number.isFinite(id)) {
		return String(id);
	}
	return typeof id === "string" &&
		id !== "" &&
		id.length <= MESSAGE_ID_MAX_LENGTH
		? id
		: null;
}

export function parseOaEvent(
	body: Readonly<Record<string, unknown>>,
): OaEvent | null {
	const eventName =
		typeof body.event_name === "string" &&
		EVENT_NAME_PATTERN.test(body.event_name)
			? body.event_name
			: null;
	const appId = idOf(body.app_id);
	if (eventName === null || appId === null) {
		return null;
	}
	const sender = idOf(recordOf(body.sender)?.id);
	const recipient = idOf(recordOf(body.recipient)?.id);
	const fromOa = eventName.startsWith(OA_SENDER_PREFIX);
	const oaId = idOf(body.oa_id) ?? (fromOa ? sender : recipient);
	if (oaId === null) {
		return null;
	}
	const userId =
		idOf(recordOf(body.follower)?.id) ??
		(fromOa ? recipient : sender) ??
		idOf(body.user_id);
	const timestamp = timestampOf(body.timestamp);
	return {
		appId,
		oaId,
		eventName,
		userId: userId === oaId ? null : userId,
		timestamp,
		occurredAt: occurredAtOf(timestamp),
		messageId: messageIdOf(body),
	};
}

function hex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function sha256Hex(text: string): Promise<string> {
	return hex(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
	);
}

export function sameHex(left: string, right: string): boolean {
	if (left.length !== right.length) {
		return false;
	}
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return difference === 0;
}

export function eventId(event: OaEvent): Promise<string> {
	return sha256Hex(
		JSON.stringify([
			event.appId,
			event.oaId,
			event.eventName,
			event.userId ?? "",
			event.timestamp,
			event.messageId ?? "",
		]),
	);
}

export function serialisations(raw: string): [SignatureMatch, string][] {
	const candidates: [SignatureMatch, string][] = [["raw", raw]];
	try {
		const compact = JSON.stringify(JSON.parse(raw));
		if (compact !== raw) {
			candidates.push(["compact", compact]);
		}
	} catch {
		return candidates;
	}
	return candidates;
}

export function oaSignature(
	appId: string,
	data: string,
	timestamp: string,
	secret: string,
): Promise<string> {
	return sha256Hex(`${appId}${data}${timestamp}${secret}`);
}

export async function verifyOaSignature(
	input: SignatureInput,
): Promise<SignatureOutcome> {
	const provided = input.header?.trim() ?? "";
	if (provided === "") {
		return "missing";
	}
	const given = MAC_PATTERN.exec(provided)?.[1]?.toLowerCase();
	if (given === undefined) {
		return "mismatch";
	}
	for (const [name, data] of serialisations(input.raw)) {
		const expected = await oaSignature(
			input.appId,
			data,
			input.timestamp,
			input.secret,
		);
		if (sameHex(expected, given)) {
			return name;
		}
	}
	return "mismatch";
}
