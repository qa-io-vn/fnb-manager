export type ValueUnit =
	| "money"
	| "count"
	| "decimal"
	| "ratio"
	| "fraction"
	| "signedFraction"
	| "percentChange";

export type NumericValueKind =
	| "money"
	| "moneyExact"
	| "moneySigned"
	| "count"
	| "countSigned"
	| "decimal"
	| "ratio"
	| "percent"
	| "signedPercent"
	| "percentPoints"
	| "pointMagnitude"
	| "percentChange"
	| "hour";

export type TextValueKind =
	| "date"
	| "weekday"
	| "month"
	| "year"
	| "isoWeek"
	| "text"
	| "message";

export type TypedValue =
	| {
			readonly kind: NumericValueKind;
			readonly value: number;
	  }
	| {
			readonly kind: TextValueKind;
			readonly value: string;
	  }
	| {
			readonly kind: "part";
			readonly value: SentencePart;
	  };

export interface SentencePart {
	readonly key: string;
	readonly values: Readonly<Record<string, TypedValue>>;
}

export function part(
	key: string,
	values: Readonly<Record<string, TypedValue>> = {},
): SentencePart {
	return { key, values };
}

export function numberValue(kind: NumericValueKind, value: number): TypedValue {
	return { kind, value };
}

export function textValue(kind: TextValueKind, value: string): TypedValue {
	return { kind, value };
}

export function messageValue(key: string): TypedValue {
	return { kind: "message", value: key };
}

export function partValue(sentence: SentencePart): TypedValue {
	return { kind: "part", value: sentence };
}

export function signedKindOf(unit: ValueUnit): NumericValueKind {
	switch (unit) {
		case "money":
			return "moneySigned";
		case "count":
			return "countSigned";
		case "decimal":
			return "decimal";
		case "ratio":
			return "ratio";
		case "fraction":
			return "percentPoints";
		case "signedFraction":
			return "signedPercent";
		case "percentChange":
			return "percentChange";
	}
}

export function plainKindOf(unit: ValueUnit): NumericValueKind {
	switch (unit) {
		case "money":
			return "money";
		case "count":
			return "count";
		case "decimal":
			return "decimal";
		case "ratio":
			return "ratio";
		case "fraction":
			return "percent";
		case "signedFraction":
			return "signedPercent";
		case "percentChange":
			return "percentChange";
	}
}

export function sentenceKeys(
	parts: readonly (SentencePart | null)[],
): string[] {
	const keys: string[] = [];
	for (const sentence of parts) {
		if (sentence === null) continue;
		keys.push(sentence.key);
		for (const value of Object.values(sentence.values)) {
			if (value.kind === "message") keys.push(value.value);
			if (value.kind === "part") keys.push(...sentenceKeys([value.value]));
		}
	}
	return keys;
}
