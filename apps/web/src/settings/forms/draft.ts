import { useState } from "react";

export type Draft<Value extends string> = Readonly<
	Record<string, Value | null>
>;

export function keepEdits<Value extends string>(
	previousSaved: Draft<Value>,
	nextSaved: Draft<Value>,
	draft: Draft<Value>,
): Draft<Value> {
	return Object.fromEntries(
		Object.entries(nextSaved).map(([key, value]) => {
			const edited =
				key in draft && (draft[key] ?? null) !== (previousSaved[key] ?? null);
			return [key, edited ? (draft[key] ?? null) : value];
		}),
	);
}

export function useSyncedDraft<Value extends string>(
	saved: Draft<Value>,
): readonly [Draft<Value>, (next: Draft<Value>) => void] {
	const [synced, setSynced] = useState<Draft<Value>>(saved);
	const [draft, setDraft] = useState<Draft<Value>>(saved);
	if (JSON.stringify(synced) !== JSON.stringify(saved)) {
		setSynced(saved);
		setDraft(keepEdits(synced, saved, draft));
	}
	return [draft, setDraft];
}
