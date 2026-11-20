import { useMutation } from "@tanstack/react-query";
import { useCustomerRead, useCustomerSource } from "../loyalty/queries";
import { SettingsWriteError } from "../settings/source";
import { useReadyTenantScope } from "../state/tenant-scope";
import {
	type DataRequestRow,
	DUE_SOON_DAYS,
	type DueRow,
	type SubjectSummary,
} from "./source";

export function useRequests(enabled: boolean) {
	return useCustomerRead<DataRequestRow[]>(
		"requests",
		[],
		(source, tenantId) => source.privacy.requests(tenantId),
		enabled,
	);
}

export function useDueSoon(enabled: boolean) {
	return useCustomerRead<DueRow[]>(
		"due",
		[DUE_SOON_DAYS],
		(source) => source.privacy.dueSoon(DUE_SOON_DAYS),
		enabled,
	);
}

export function useSubjectLookup() {
	const state = useCustomerSource();
	const { tenant } = useReadyTenantScope();
	return useMutation<SubjectSummary[], unknown, string>({
		mutationFn: async (phone) => {
			if (state.status !== "ready") throw new SettingsWriteError("network");
			const rows = await state.source.privacy.lookupSubjects(phone);
			return rows.filter((row) => row.tenantId === tenant.id);
		},
	});
}
