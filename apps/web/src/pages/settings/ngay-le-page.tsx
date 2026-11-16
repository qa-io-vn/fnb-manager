import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { type MessageKey, type Translate, useT } from "../../i18n";
import { todayIn } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import type { SaveBarStatus } from "../../settings/forms/save-bar";
import { SelectField } from "../../settings/forms/select-field";
import { CustomHolidays } from "../../settings/holidays/custom-holidays";
import { GlobalHolidays } from "../../settings/holidays/global-holidays";
import {
	defaultHolidayYear,
	HOLIDAY_FIRST_YEAR,
	HOLIDAY_LAST_YEAR,
	HOLIDAY_YEARS,
	holidayYearOf,
	NATIONAL_CALENDAR_YEARS,
	withAddedHoliday,
	withoutHoliday,
} from "../../settings/holidays/holidays";
import { settingsQueryKey, useHolidays } from "../../settings/queries";
import {
	useRetrySettingsSource,
	useSettingsSourceState,
} from "../../settings/settings-source-context";
import type {
	HolidayChange,
	HolidayRow,
	SettingsSource,
	SettingsWriteCode,
} from "../../settings/source";
import { useSettingsAccess } from "../../settings/use-settings-access";
import { useSettingsMutation } from "../../settings/use-settings-mutation";
import { useFormatters } from "../../state/formatters";
import { useReadyTenantScope } from "../../state/tenant-scope";

type HolidayAction =
	| { readonly kind: "add"; readonly change: HolidayChange }
	| { readonly kind: "delete"; readonly row: HolidayRow };

interface ActionState {
	readonly saving: boolean;
	readonly saved: boolean;
	readonly errorCode: SettingsWriteCode | null;
	readonly errorKey: MessageKey | null;
	readonly canRetry: boolean;
}

export function holidayErrorKey(
	action: HolidayAction["kind"],
	state: Pick<ActionState, "errorCode" | "errorKey">,
): MessageKey | null {
	if (action === "add" && state.errorCode === "duplicate") {
		return "settings.holidays.add.duplicate";
	}
	return state.errorKey;
}

function actionStatus(
	t: Translate,
	formatters: Formatters,
	action: HolidayAction,
	state: ActionState,
): SaveBarStatus | null {
	if (state.saving) return { tone: "info", text: t("settings.saving") };
	const errorKey = holidayErrorKey(action.kind, state);
	if (errorKey !== null) return { tone: "error", text: t(errorKey) };
	if (!state.saved) return null;
	const date =
		action.kind === "add" ? action.change.holidayDate : action.row.holidayDate;
	const day = t("settings.holidays.day", {
		weekday: formatters.weekday(date),
		date: formatters.date(date),
	});
	return action.kind === "add"
		? {
				tone: "success",
				text: t("settings.holidays.add.added", {
					name: action.change.name,
					date: day,
				}),
			}
		: {
				tone: "success",
				text: t("settings.holidays.custom.deleted", {
					name: action.row.name,
					date: day,
				}),
			};
}

function YearChoice({
	year,
	onChange,
}: {
	readonly year: number;
	readonly onChange: (year: number) => void;
}) {
	const t = useT();
	const id = useId();
	return (
		<SelectField
			id={id}
			label={t("settings.holidays.yearLabel")}
			hint={t("settings.holidays.yearHint", {
				first: HOLIDAY_FIRST_YEAR,
				last: HOLIDAY_LAST_YEAR,
				from: NATIONAL_CALENDAR_YEARS.from,
				to: NATIONAL_CALENDAR_YEARS.to,
			})}
			value={String(year)}
			options={HOLIDAY_YEARS.map((option) => ({
				value: String(option),
				label: String(option),
			}))}
			onChange={(value) => onChange(Number(value))}
			className="sm:max-w-56"
			testId="holidays-year"
		/>
	);
}

function HolidaysBody() {
	const t = useT();
	const { tenant } = useReadyTenantScope();
	const formatters = useFormatters(tenant);
	const today = todayIn(tenant.timeZone, new Date());
	const [year, setYear] = useState(() => defaultHolidayYear(today));
	const holidays = useHolidays(year);
	const access = useSettingsAccess("holidays");
	const sourceState = useSettingsSourceState();
	const retrySource = useRetrySettingsSource();
	const queryClient = useQueryClient();
	const [action, setAction] = useState<HolidayAction | null>(null);
	const writeAdd = useCallback(
		async (source: SettingsSource, tenantId: string, change: HolidayChange) => {
			const added = await source.addHoliday(tenantId, change);
			queryClient.setQueryData<HolidayRow[]>(
				settingsQueryKey(
					source.kind,
					tenantId,
					"holidays",
					holidayYearOf(added.holidayDate),
				),
				(previous) => withAddedHoliday(previous, added),
			);
		},
		[queryClient],
	);
	const writeDelete = useCallback(
		async (source: SettingsSource, tenantId: string, row: HolidayRow) => {
			await source.deleteHoliday(tenantId, row.id);
			queryClient.setQueryData<HolidayRow[]>(
				settingsQueryKey(
					source.kind,
					tenantId,
					"holidays",
					holidayYearOf(row.holidayDate),
				),
				(previous) => withoutHoliday(previous, row.id),
			);
		},
		[queryClient],
	);
	const add = useSettingsMutation(writeAdd);
	const remove = useSettingsMutation(writeDelete);
	const busy = add.saving || remove.saving;
	const current = action === null ? null : action.kind === "add" ? add : remove;
	const status =
		action === null || current === null
			? null
			: actionStatus(t, formatters, action, current);
	const [clearSignal, setClearSignal] = useState(0);
	const sectionRef = useRef<HTMLElement>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const focusHeadingIfLost = () => {
		const active = document.activeElement;
		const section = sectionRef.current;
		if (
			active === null ||
			active === document.body ||
			section?.contains(active) === true
		) {
			headingRef.current?.focus();
		}
	};
	const afterAdd = (change: HolidayChange) => {
		setClearSignal((count) => count + 1);
		setYear(holidayYearOf(change.holidayDate));
	};
	const onAdd = (change: HolidayChange) => {
		remove.reset();
		setAction({ kind: "add", change });
		void add.save(change).then((ok) => {
			if (ok) afterAdd(change);
		});
	};
	const onDelete = (row: HolidayRow) => {
		add.reset();
		setAction({ kind: "delete", row });
		void remove.save(row).then((ok) => {
			if (ok) focusHeadingIfLost();
		});
	};
	const onRetry = () => {
		if (action === null) return;
		if (action.kind === "add") {
			void add.retry().then((ok) => {
				if (!ok) return;
				afterAdd(action.change);
				focusHeadingIfLost();
			});
			return;
		}
		void remove.retry().then((ok) => {
			if (ok) focusHeadingIfLost();
		});
	};
	const onEdit = () => {
		if (action !== null && current !== null && !current.saving) {
			current.reset();
			setAction(null);
		}
	};
	const sourceFailed = sourceState.status === "failed";
	const pending =
		sourceFailed || holidays.status === "error" ? (
			<div
				role="alert"
				className="space-y-2"
				data-testid="holidays-load-failed"
			>
				<p>{t("settings.holidays.loadFailed", { year })}</p>
				<Button
					tone="secondary"
					size="compact"
					onClick={sourceFailed ? retrySource : () => void holidays.refetch()}
				>
					{t("app.retry")}
				</Button>
			</div>
		) : (
			<p role="status" data-testid="holidays-loading">
				{t("app.loading")}
			</p>
		);
	return (
		<div className="space-y-4" data-testid="holidays-page" data-year={year}>
			<YearChoice year={year} onChange={setYear} />
			<CustomHolidays
				year={year}
				rows={holidays.data?.filter((row) => row.custom)}
				pending={pending}
				clearSignal={clearSignal}
				sectionRef={sectionRef}
				headingRef={headingRef}
				formatters={formatters}
				timeZone={tenant.timeZone}
				today={today}
				access={access}
				busy={busy}
				status={status}
				onRetry={current?.canRetry === true ? onRetry : null}
				onAdd={onAdd}
				onDelete={onDelete}
				onEdit={onEdit}
			/>
			{holidays.data === undefined ? null : (
				<GlobalHolidays
					year={year}
					rows={holidays.data.filter((row) => !row.custom)}
					formatters={formatters}
				/>
			)}
		</div>
	);
}

export default function NgayLePage() {
	const { tenant } = useReadyTenantScope();
	return <HolidaysBody key={tenant.id} />;
}
