import {
	eventId,
	oaSignature,
	parseOaEvent,
	sameHex,
	serialisations,
	verifyOaSignature,
} from "./signature.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
	const left = JSON.stringify(actual);
	const right = JSON.stringify(expected);
	assert(left === right, `${label}: expected ${right}, got ${left}`);
}

const APP_ID = "synthetic-app-1";
const OA_ID = "synthetic-oa-1";
const SECRET = "synthetic-oa-secret-key";
const TIMESTAMP = "1794970800000";

const MESSAGE = {
	app_id: APP_ID,
	user_id_by_app: "synthetic-app-user-1",
	event_name: "user_send_text",
	timestamp: TIMESTAMP,
	sender: { id: "synthetic-user-1" },
	recipient: { id: OA_ID },
	message: { text: "Xin chào", msg_id: "synthetic-msg-1" },
};

const COMPACT = JSON.stringify(MESSAGE);
const PRETTY = JSON.stringify(MESSAGE, null, 2);
const COMPACT_MAC =
	"cc6d6f6af6c5dd19cbc81bd758b79e536f45705d716b65febc0fc68385af42bf";
const PRETTY_MAC =
	"c8c081d867599b5631dd76448d5f3831380ef2ace32db5af67df3f39391ac482";
const MESSAGE_EVENT_ID =
	"1b4394a9ee21c71c718b4edc1777e256e1e5ab0d3bf527347608ea93bc7271e7";

function check(header: string | null, raw: string, secret = SECRET) {
	return verifyOaSignature({
		header,
		appId: APP_ID,
		raw,
		timestamp: TIMESTAMP,
		secret,
	});
}

Deno.test("the signature is sha256 of app id, body, timestamp and OA secret key", async () => {
	assertEquals(
		await oaSignature(APP_ID, COMPACT, TIMESTAMP, SECRET),
		COMPACT_MAC,
		"compact vector",
	);
	assertEquals(
		await oaSignature(APP_ID, PRETTY, TIMESTAMP, SECRET),
		PRETTY_MAC,
		"pretty vector",
	);
});

Deno.test("the header is accepted as mac=<hex>, bare hex or upper-case hex", async () => {
	assertEquals(await check(`mac=${COMPACT_MAC}`, COMPACT), "raw", "mac=");
	assertEquals(await check(COMPACT_MAC, COMPACT), "raw", "bare");
	assertEquals(
		await check(` MAC=${COMPACT_MAC.toUpperCase()} `, COMPACT),
		"raw",
		"upper case with spaces",
	);
});

Deno.test("a body signed over its exact bytes matches raw, one signed compact matches compact", async () => {
	assertEquals(await check(`mac=${PRETTY_MAC}`, PRETTY), "raw", "raw bytes");
	assertEquals(
		await check(`mac=${COMPACT_MAC}`, PRETTY),
		"compact",
		"compact serialisation of a pretty body",
	);
	assertEquals(
		serialisations(COMPACT).map(([name]) => name),
		["raw"],
		"a compact body has one serialisation",
	);
	assertEquals(
		serialisations("not json").map(([name]) => name),
		["raw"],
		"a body that is not JSON has its raw bytes only",
	);
});

Deno.test("a wrong key, app, timestamp, body or header shape is a mismatch; no header is missing", async () => {
	assertEquals(
		await check(`mac=${COMPACT_MAC}`, COMPACT, "another-secret"),
		"mismatch",
		"wrong secret",
	);
	assertEquals(
		await verifyOaSignature({
			header: `mac=${COMPACT_MAC}`,
			appId: "synthetic-app-2",
			raw: COMPACT,
			timestamp: TIMESTAMP,
			secret: SECRET,
		}),
		"mismatch",
		"wrong app",
	);
	assertEquals(
		await verifyOaSignature({
			header: `mac=${COMPACT_MAC}`,
			appId: APP_ID,
			raw: COMPACT,
			timestamp: "1794970800001",
			secret: SECRET,
		}),
		"mismatch",
		"wrong timestamp",
	);
	assertEquals(
		await check(`mac=${COMPACT_MAC}`, COMPACT.replace("chào", "chao")),
		"mismatch",
		"changed body",
	);
	assertEquals(
		await check(`sha256=${COMPACT_MAC}`, COMPACT),
		"mismatch",
		"other prefix",
	);
	assertEquals(
		await check(COMPACT_MAC.slice(1), COMPACT),
		"mismatch",
		"short hex",
	);
	assertEquals(await check(null, COMPACT), "missing", "no header");
	assertEquals(await check("  ", COMPACT), "missing", "blank header");
});

Deno.test("hex comparison needs equal length and equal characters", () => {
	assert(sameHex("ab12", "ab12"), "equal");
	assert(!sameHex("ab12", "ab13"), "different");
	assert(!sameHex("ab12", "ab1"), "shorter");
});

Deno.test("a user message names the OA as recipient and the user as sender", async () => {
	const event = parseOaEvent(MESSAGE);
	assertEquals(
		event,
		{
			appId: APP_ID,
			oaId: OA_ID,
			eventName: "user_send_text",
			userId: "synthetic-user-1",
			timestamp: TIMESTAMP,
			occurredAt: new Date(Number(TIMESTAMP)),
			messageId: "synthetic-msg-1",
		},
		"parsed message",
	);
	assert(event !== null, "parsed");
	assertEquals(await eventId(event), MESSAGE_EVENT_ID, "event id vector");
});

Deno.test("follow, unfollow and OA messages name the right OA and user", () => {
	const follow = parseOaEvent({
		oa_id: OA_ID,
		follower: { id: "synthetic-user-2" },
		user_id_by_app: "synthetic-app-user-2",
		event_name: "follow",
		source: "testing_webhook",
		app_id: APP_ID,
		timestamp: Number(TIMESTAMP),
	});
	assertEquals(
		[follow?.oaId, follow?.userId, follow?.timestamp],
		[OA_ID, "synthetic-user-2", TIMESTAMP],
		"follow",
	);
	const sent = parseOaEvent({
		app_id: APP_ID,
		event_name: "oa_send_text",
		timestamp: TIMESTAMP,
		sender: { id: OA_ID },
		recipient: { id: "synthetic-user-3" },
		message: { text: "Chào bạn", msg_id: "synthetic-msg-2" },
	});
	assertEquals(
		[sent?.oaId, sent?.userId],
		[OA_ID, "synthetic-user-3"],
		"OA message",
	);
});

Deno.test("an event without an app id, an OA or a valid name is not routable", () => {
	assertEquals(parseOaEvent({ ...MESSAGE, app_id: undefined }), null, "no app");
	assertEquals(parseOaEvent({ ...MESSAGE, recipient: {} }), null, "no OA");
	assertEquals(
		parseOaEvent({ ...MESSAGE, event_name: "User Send" }),
		null,
		"bad name",
	);
	assertEquals(
		parseOaEvent({ ...MESSAGE, recipient: { id: "not an id!" } }),
		null,
		"bad OA id",
	);
});

Deno.test("the event id changes with the message id and stays without one", async () => {
	const first = parseOaEvent(MESSAGE);
	const second = parseOaEvent({
		...MESSAGE,
		message: { text: "Xin chào", msg_id: "synthetic-msg-9" },
	});
	const bare = parseOaEvent({ ...MESSAGE, message: { text: "Xin chào" } });
	assert(first && second && bare, "parsed");
	assert((await eventId(first)) !== (await eventId(second)), "msg_id counts");
	assertEquals(
		await eventId(bare),
		await eventId({ ...bare }),
		"stable without a message id",
	);
	assertEquals(bare.messageId, null, "no message id");
});

Deno.test("a timestamp that is not a millisecond count leaves the event time to the receiver", () => {
	const event = parseOaEvent({ ...MESSAGE, timestamp: "yesterday" });
	assertEquals([event?.timestamp, event?.occurredAt], ["", null], "unusable");
	const early = parseOaEvent({ ...MESSAGE, timestamp: "1000" });
	assertEquals(early?.occurredAt, null, "before 2015");
});
