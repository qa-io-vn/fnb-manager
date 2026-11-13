import { reportDefinitions } from "@fnb/reports";
import { ReportPage } from "../../../reports/report-page";

export function MonthReportPage() {
	return <ReportPage definition={reportDefinitions.month} />;
}
