import type { Sql } from "../oa-webhook/database.ts";
import {
	type CallbackDecision,
	type CallbackQuestion,
	DECIDED_OUTCOMES,
	type StoreOutcome,
	type VoucherCallbackStore,
} from "./handler.ts";

const STORE_OUTCOMES: ReadonlySet<string> = new Set<string>([
	...DECIDED_OUTCOMES,
	"unknown_path",
	"refused_address",
	"malformed",
]);

interface AnswerRow {
	readonly answer: {
		readonly outcome?: unknown;
		readonly discount_amount?: unknown;
		readonly reward_name?: unknown;
	} | null;
}

export function decisionOf(row: AnswerRow | undefined): CallbackDecision {
	const answer = row?.answer;
	const outcome = answer?.outcome;
	if (typeof outcome !== "string" || !STORE_OUTCOMES.has(outcome)) {
		throw new Error("app.answer_voucher_callback answered an unknown outcome");
	}
	const amount = Number(answer?.discount_amount ?? 0);
	return {
		outcome: outcome as StoreOutcome,
		discountAmount:
			Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0,
		rewardName:
			typeof answer?.reward_name === "string" ? answer.reward_name : null,
	};
}

export class PostgresVoucherCallbackStore implements VoucherCallbackStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
	}

	async answer(question: CallbackQuestion): Promise<CallbackDecision> {
		const [row] = await this.sql<AnswerRow[]>`
			select app.answer_voucher_callback(
				${question.pathSha256}::text,
				${question.sourceIp}::inet,
				${question.storeRef}::text,
				${question.programmeRef}::text,
				${question.code}::text,
				${question.saleRef}::text,
				${question.memberPhone}::text,
				${this.sql.json(question.lines.map((line) => ({ item: line.item, quantity: line.quantity, amount: line.amount })))}::jsonb,
				${question.receivedAt.toISOString()}::timestamptz,
				now()
			) as answer
		`;
		return decisionOf(row);
	}
}
