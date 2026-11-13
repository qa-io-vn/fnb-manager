import { reportDefinitions } from "@fnb/reports";
import { ReportPage } from "../../../reports/report-page";

export function DayReportPage() {
	return <ReportPage definition={reportDefinitions.day} />;
}
