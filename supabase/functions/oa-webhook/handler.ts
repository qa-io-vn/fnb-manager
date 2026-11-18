import {
	type FunctionEnvironment,
	type FunctionHandler,
	HttpError,
	json,
	type RequestContext,
	readJsonObject,
	requireMethod,
} from "../_shared/http.ts";
import {
	eventId,
	type OaEvent,
	parseOaEvent,
	SIGNATURE_HEADER,
	type SignatureOutcome,
	verifyOaSignature,
} from "./signature.ts";

export const FUNCTION_NAME = "oa-webhook";
export const MAX_EVENT_BYTES = 65_536;
export const ACK_DEADLINE_MS = 1_500;

export type WebhookMode = "observe" | "enforce";

export interface OaTarget {
	readonly oaId: string;
	readonly tenantId: string;
	readonly secretName: string;
	readonly webhookMode: WebhookMode;
}

export interface ReceivedEvent {
	readonly oaId: string;
	readonly eventId: string;
	readonly eventName: string;
	readonly oaUserId: string | null;
	readonly occurredAt: Date | null;
	readonly signature: SignatureOutcome;
	readonly receivedAt: Date;
}

export interface Reception {
	readonly outcome: "recorded" | "duplicate" | "refused";
	readonly eventRow: string | null;
	readonly unverified: number | null;
}

export interface OaWebhookStore {
	targets(appId: string, oaId: string): Promise<readonly OaTarget[]>;
	receive(event: ReceivedEvent): Promise<Reception>;
	apply(eventRow: string, at: Date): Promise<string>;
	raiseAlert(oaId: string, unverified: number, at: Date): Promise<string>;
}

export interface OaWebhookDependencies {
	store(
		environment: FunctionEnvironment,
		context: RequestContext,
	): OaWebhookStore;
	clock(): Date;
	waitUntil(promise: Promise<unknown>): void;
	readonly ackDeadlineMs: number;
}

type Intake =
	| { readonly kind: "unrouted"; readonly targets: number }
	| {
			readonly kind: "received";
			readonly target: OaTarget;
			readonly signature: SignatureOutcome;
			readonly reception: Reception;
	  };

const LATE = Symbol("late");

async function within<T>(
	work: Promise<T>,
	milliseconds: number,
): Promise<T | typeof LATE> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<typeof LATE>((resolve) => {
		timer = setTimeout(() => resolve(LATE), milliseconds);
	});
	try {
		return await Promise.race([work, deadline]);
	} finally {
		clearTimeout(timer);
	}
}

async function intake(
	dependencies: OaWebhookDependencies,
	context: RequestContext,
	event: OaEvent,
	raw: string,
	header: string | null,
	receivedAt: Date,
): Promise<Intake> {
	const store = dependencies.store(context.environment, context);
	const targets = await store.targets(event.appId, event.oaId);
	const target = targets[0];
	if (targets.length !== 1 || target === undefined) {
		return { kind: "unrouted", targets: targets.length };
	}
	const secret = context.secret(target.secretName);
	const signature = await verifyOaSignature({
		header,
		appId: event.appId,
		raw,
		timestamp: event.timestamp,
		secret,
	});
	const reception = await store.receive({
		oaId: target.oaId,
		eventId: await eventId(event),
		eventName: event.eventName,
		oaUserId: event.userId,
		occurredAt: event.occurredAt,
		signature,
		receivedAt,
	});
	return { kind: "received", target, signature, reception };
}

async function followUp(
	dependencies: OaWebhookDependencies,
	context: RequestContext,
	eventName: string,
	result: Intake,
): Promise<void> {
	if (result.kind === "unrouted") {
		context.log(
			result.targets === 0
				? `${eventName}: no configured OA matches the app and OA of the event; nothing stored`
				: `${eventName}: the app and OA match ${result.targets} configured OAs; nothing stored`,
		);
		return;
	}
	const { reception, signature, target } = result;
	const store = dependencies.store(context.environment, context);
	const applied =
		reception.eventRow === null
			? "none"
			: await store.apply(reception.eventRow, dependencies.clock());
	const alert =
		reception.unverified === null
			? "none"
			: await store.raiseAlert(
					target.oaId,
					reception.unverified,
					dependencies.clock(),
				);
	context.log(
		`${eventName}: ${reception.outcome}, signature ${signature}, mode ${target.webhookMode}, follow-up ${applied}, alert ${alert}`,
	);
}

function scheduleFollowUp(
	dependencies: OaWebhookDependencies,
	context: RequestContext,
	eventName: string,
	work: Promise<Intake>,
): void {
	dependencies.waitUntil(
		work
			.then((result) => followUp(dependencies, context, eventName, result))
			.catch((error: unknown) => {
				context.log(
					`${eventName}: follow-up failed: ${context.errorMessage(error)}`,
				);
			}),
	);
}

export function createOaWebhookHandler(
	dependencies: OaWebhookDependencies,
): FunctionHandler {
	return async (request, context) => {
		requireMethod(request, "POST");
		const { raw, body } = await readJsonObject(request, MAX_EVENT_BYTES);
		const event = parseOaEvent(body);
		if (event === null) {
			context.log(
				"ignored a body without an app id, an OA id or an event name",
			);
			return json({ ok: true }, 200);
		}
		const receivedAt = dependencies.clock();
		const work = intake(
			dependencies,
			context,
			event,
			raw,
			request.headers.get(SIGNATURE_HEADER),
			receivedAt,
		);
		const settled = await within(work, dependencies.ackDeadlineMs);
		scheduleFollowUp(dependencies, context, event.eventName, work);
		if (settled === LATE) {
			context.log(
				`${event.eventName}: answered before the event was stored; it is stored after the answer`,
			);
			return json({ ok: true }, 200);
		}
		if (
			settled.kind === "received" &&
			settled.reception.outcome === "refused"
		) {
			throw new HttpError(401, "invalid_signature");
		}
		return json({ ok: true }, 200);
	};
}
