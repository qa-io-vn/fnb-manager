import {
	parseVoucherCallback,
	type VoucherCallbackLine,
	type VoucherCallbackReply,
	voucherCallbackResponse,
} from "@fnb/connector-ipos/voucher-callback";
import type { JsonObject } from "@fnb/sync";
import {
	type FunctionEnvironment,
	type FunctionHandler,
	HttpError,
	json,
	type RequestContext,
	readBody,
} from "../_shared/http.ts";

export const FUNCTION_NAME = "voucher-callback";
export const MAX_CALLBACK_BYTES = 65_536;
export const ANSWER_BUDGET_MS = 2_500;

const SEGMENT_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const IPV4_PATTERN =
	/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_PATTERN = /^[0-9A-Fa-f:.]{2,45}$/;

export const DECIDED_OUTCOMES = [
	"accepted",
	"replayed",
	"unknown_store",
	"disabled",
	"wrong_programme",
	"unknown_code",
	"wrong_store",
	"used",
	"expired",
	"released",
	"wrong_member",
	"below_minimum",
	"not_applicable",
] as const;

export type DecidedOutcome = (typeof DECIDED_OUTCOMES)[number];
export type StoreOutcome =
	| DecidedOutcome
	| "unknown_path"
	| "refused_address"
	| "malformed";
export type CallbackOutcome = StoreOutcome | "amount_out_of_range" | "busy";

export const DESCRIPTIONS: Readonly<
	Record<Exclude<CallbackOutcome, "accepted" | "replayed">, string>
> = {
	unknown_path: "Không tìm thấy",
	refused_address: "Địa chỉ gọi không được phép",
	malformed: "Yêu cầu không hợp lệ",
	amount_out_of_range: "Số tiền trên hóa đơn không hợp lệ",
	busy: "Hệ thống đang bận, vui lòng nhập lại mã",
	unknown_store: "Cửa hàng chưa được cấu hình cho chương trình này",
	disabled: "Cửa hàng chưa bật kiểm tra mã ưu đãi",
	wrong_programme: "Mã không thuộc chương trình này",
	unknown_code: "Mã không hợp lệ",
	wrong_store: "Mã không áp dụng tại cửa hàng này",
	used: "Mã đã được sử dụng",
	expired: "Mã đã hết hạn",
	released: "Mã đã hết hiệu lực",
	wrong_member: "Mã không thuộc khách hàng này",
	below_minimum: "Hóa đơn chưa đạt giá trị tối thiểu",
	not_applicable: "Hóa đơn không có món được áp dụng",
};

export interface CallbackQuestion {
	readonly pathSha256: string;
	readonly sourceIp: string | null;
	readonly storeRef: string;
	readonly programmeRef: string | null;
	readonly code: string;
	readonly saleRef: string;
	readonly memberPhone: string | null;
	readonly lines: readonly VoucherCallbackLine[];
	readonly receivedAt: Date;
}

export interface CallbackDecision {
	readonly outcome: StoreOutcome;
	readonly discountAmount: number;
	readonly rewardName: string | null;
}

export interface VoucherCallbackStore {
	answer(question: CallbackQuestion): Promise<CallbackDecision>;
}

export interface VoucherCallbackDependencies {
	store(
		environment: FunctionEnvironment,
		context: RequestContext,
	): VoucherCallbackStore;
	clock(): Date;
	readonly budgetMs?: number;
}

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function pathSegment(url: string): string | null {
	const parts = new URL(url).pathname.split("/").filter((part) => part !== "");
	const at = parts.lastIndexOf(FUNCTION_NAME);
	if (at < 0 || at !== parts.length - 2) {
		return null;
	}
	const segment = parts[at + 1] ?? "";
	return SEGMENT_PATTERN.test(segment) ? segment : null;
}

export function sourceAddress(request: Request): string | null {
	const forwarded = request.headers.get("x-forwarded-for");
	const first = forwarded?.split(",")[0]?.trim() ?? "";
	if (IPV4_PATTERN.test(first)) {
		return first;
	}
	return first.includes(":") && IPV6_PATTERN.test(first) ? first : null;
}

function reply(
	outcome: CallbackOutcome,
	decision?: CallbackDecision,
): VoucherCallbackReply {
	if (
		(outcome === "accepted" || outcome === "replayed") &&
		decision !== undefined &&
		decision.discountAmount > 0
	) {
		return {
			discountAmount: decision.discountAmount,
			description: decision.rewardName ?? "Ưu đãi",
			accepted: true,
		};
	}
	return {
		discountAmount: 0,
		description:
			outcome === "accepted" || outcome === "replayed"
				? DESCRIPTIONS.not_applicable
				: DESCRIPTIONS[outcome],
		accepted: false,
	};
}

function statusOf(outcome: CallbackOutcome): number {
	switch (outcome) {
		case "malformed":
			return 400;
		case "amount_out_of_range":
			return 422;
		case "refused_address":
			return 403;
		default:
			return 200;
	}
}

async function withinBudget<T>(
	work: Promise<T>,
	ms: number,
): Promise<T | "busy"> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expiry = new Promise<"busy">((resolve) => {
		timer = setTimeout(() => resolve("busy"), ms);
	});
	try {
		return await Promise.race([work, expiry]);
	} finally {
		clearTimeout(timer);
	}
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

export function createVoucherCallbackHandler(
	dependencies: VoucherCallbackDependencies,
): FunctionHandler {
	const budget = dependencies.budgetMs ?? ANSWER_BUDGET_MS;
	return async (request, context) => {
		const receivedAt = dependencies.clock();
		const started = Date.now();
		const segment = pathSegment(request.url);
		if (segment === null) {
			context.log("refused a call outside the secret path");
			return json({ error: "not_found", request_id: context.requestId }, 404);
		}
		context.protect(segment);
		if (request.method !== "POST") {
			throw new HttpError(405, "method_not_allowed");
		}
		const finish = (
			outcome: CallbackOutcome,
			echo: Readonly<Record<string, unknown>> | null,
			decision?: CallbackDecision,
		): Response => {
			const answer = reply(outcome, decision);
			context.log(
				`answered ${outcome} with ${answer.discountAmount > 0 ? "a discount" : "no discount"} in ${Date.now() - started} ms`,
			);
			return json(
				voucherCallbackResponse(echo, answer) as JsonObject,
				statusOf(outcome),
			);
		};
		const body = parseJson(await readBody(request, MAX_CALLBACK_BYTES));
		const parsed = parseVoucherCallback(body);
		if (!parsed.ok) {
			context.log(
				`refused a ${parsed.reason} payload (fields: ${parsed.fields.slice(0, 10).join(", ") || "body"})`,
			);
			return finish(parsed.reason, parsed.echo);
		}
		const { request: question } = parsed;
		context.protect(question.code);
		context.protect(question.saleRef);
		if (question.memberPhone !== null) {
			context.protect(question.memberPhone);
		}
		const store = dependencies.store(context.environment, context);
		const decision = await withinBudget(
			store.answer({
				pathSha256: await sha256Hex(segment),
				sourceIp: sourceAddress(request),
				storeRef: question.storeRef,
				programmeRef: question.programmeRef,
				code: question.code,
				saleRef: question.saleRef,
				memberPhone: question.memberPhone,
				lines: question.lines,
				receivedAt,
			}),
			budget,
		);
		if (decision === "busy") {
			return finish("busy", parsed.echo);
		}
		if (decision.outcome === "unknown_path") {
			context.log("refused a call whose path segment matches no tenant");
			return json({ error: "not_found", request_id: context.requestId }, 404);
		}
		return finish(decision.outcome, parsed.echo, decision);
	};
}
