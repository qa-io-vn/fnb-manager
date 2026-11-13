import { reportDefinitions } from "@fnb/reports";
import { ReportPage } from "../../../reports/report-page";

export function YearReportPage() {
	return <ReportPage definition={reportDefinitions.year} />;
}
