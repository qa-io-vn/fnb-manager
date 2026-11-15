import { type MessageKey, useT } from "../../i18n";
import { CSV_DIALECTS, type CsvDialect } from "../../lib/csv";
import { usePreferences } from "../../state/preferences";

const DIALECT_KEYS: Readonly<Record<CsvDialect, MessageKey>> = {
	comma: "settings.thresholds.device.csv.comma",
	semicolon: "settings.thresholds.device.csv.semicolon",
};

const TITLE_ID = "thresholds-device-title";
const SEMICOLON_HINT_ID = "thresholds-device-semicolon-hint";

export function DeviceCsvChoice() {
	const t = useT();
	const { preferences, update } = usePreferences();
	return (
		<section
			aria-labelledby={TITLE_ID}
			className="space-y-3 rounded-xl border border-line bg-surface-raised p-4"
			data-testid="device-csv-choice"
		>
			<h3 id={TITLE_ID} className="text-base font-semibold">
				{t("settings.thresholds.device.title")}
			</h3>
			<p className="text-sm text-ink-muted">
				{t("settings.thresholds.device.hint")}
			</p>
			<fieldset aria-describedby={SEMICOLON_HINT_ID} className="space-y-2">
				<legend className="text-sm font-medium">
					{t("settings.thresholds.device.csv")}
				</legend>
				{CSV_DIALECTS.map((dialect) => (
					<label
						key={dialect}
						className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2 has-checked:border-accent"
					>
						<input
							type="radio"
							name="csv-dialect"
							className="size-6 shrink-0 accent-accent"
							checked={preferences.csvDialect === dialect}
							onChange={() => update({ csvDialect: dialect })}
							data-testid={`csv-dialect-${dialect}`}
						/>
						<span>{t(DIALECT_KEYS[dialect])}</span>
					</label>
				))}
				<p id={SEMICOLON_HINT_ID} className="text-xs text-ink-muted">
					{t("settings.thresholds.device.csv.semicolonHint")}
				</p>
			</fieldset>
		</section>
	);
}
