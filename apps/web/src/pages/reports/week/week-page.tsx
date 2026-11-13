import { reportDefinitions } from "@fnb/reports";
import { ReportPage } from "../../../reports/report-page";

export function WeekReportPage() {
	return <ReportPage definition={reportDefinitions.week} />;
}
