import type { MessageKey } from "./vi.js";

export const EN_MESSAGES: Readonly<Record<MessageKey, string>> = {
	"test.subject": "Test message from FNB Manager",
	"test.body":
		"Test message from FNB Manager: the {label} channel works at {time} {date}. This is an automated message.",
	"link_confirmation.subject": "Linked to receive digests",
	"link_confirmation.body":
		"Linked. You will receive the daily digest and the operational alerts of {tenant} here. This is an automated message; turn it off or change the channel in Settings → Alerts.",
	"link_code.subject": "Confirmation code for digests",
	"link_code.body":
		"{notice}\n\nIf you agree to receive digests and alerts, enter this code (or give it to the person linking for you): {code}. The code expires after 15 minutes. If you do not agree or did not ask for it, ignore this e-mail.",
	"link_notice.subject": "Notice before you receive digests",
	"link_notice.body":
		"{notice}\n\nThis is an automated message. Reply ĐỒNG Ý to receive digests and alerts. If you do not agree, ignore this message; the link code expires by itself.",
	"link.handover":
		"Send this whole block to the recipient if you link for them:\n{notice}\nSend the code {code} to {bot} within 15 minutes, then reply ĐỒNG Ý when the bot asks.",
	"link.instruction": "Send the code {code} to {bot} within 15 minutes.",
	"link.retry":
		"If no confirmation arrives after 1 minute, send the code again.",
	"digest.title": "Daily digest {date} ({weekday})",
	"digest.subject": "Daily digest {date} · {scope}",
	"digest.scope.all": "All {count} stores",
	"digest.scope.one": "{store}",
	"digest.scope.some": "{count} stores",
	"digest.state.verified": "reconciled",
	"digest.state.unverified":
		"not reconciled yet, figures may change after the nightly sync",
	"digest.state.unmatched": "not matching the POS at {stores}",
	"digest.state.partial": "{stores} not fully synced, figures up to {time}",
	"digest.state.stores.more": "{stores} and {count} other stores",
	"digest.state.no_data": "No invoice yet on {date}.",
	"digest.stale": "Some figures are being updated.",
	"digest.net": "Net revenue: {net}",
	"digest.vsBaseline": "• Against the same-weekday baseline: {change}",
	"digest.vsBaseline.partial":
		"• Against the same-weekday baseline ({weeks}/8 weeks): {change}",
	"digest.vsBaseline.building":
		"• Not enough data yet for the same-weekday baseline",
	"digest.vsPrevious": "• Against the previous day: {change}",
	"digest.vsPrevious.likeForLike":
		"• Against the previous day (the same {covered}/{total} stores): {change}",
	"digest.invoices": "Invoices: {invoices} · Average {ticket}/invoice",
	"digest.invoices.only": "Invoices: {invoices}",
	"digest.cash": "Cash to count: {cash}",
	"digest.peak": "Peak: {hour}:00 ({net})",
	"digest.topItems": "Best sellers: {items}",
	"digest.topItem": "{item} ({quantity})",
	"digest.holiday":
		"Holiday ({kind}): the baseline leaves out holidays and Tết.",
	"digest.holiday.tet": "Tết",
	"digest.holiday.holiday": "holiday",
	"digest.stores.title": "By store:",
	"digest.stores.line": "• {store}: {net} ({change} against the baseline)",
	"digest.stores.line.partial":
		"• {store}: {net} ({change} against the baseline, {weeks}/8 weeks)",
	"digest.stores.line.building":
		"• {store}: {net} (not enough data yet for the baseline)",
	"digest.stores.closed": "• {store}: closed",
	"digest.stores.noSales": "• {store}: no invoice",
	"digest.stores.unsettled": "• {store}: not fully synced",
	"digest.stores.shiftOpen":
		"• {store}: a shift is still open, figures up to {time}",
	"digest.stores.more": "• and {count} other stores",
	"digest.attention.title": "Needs attention ({count}):",
	"digest.attention.more": "• and {count} other items",
	"digest.finding.revenue_below_baseline":
		"• {store}: net revenue only {ratio} of the same-weekday baseline (threshold {threshold}).",
	"digest.finding.ticket_drop":
		"• {store}: average invoice {ticket}, down {drop} against {reference}.",
	"digest.finding.ticket_drop.baseline": "the baseline",
	"digest.finding.ticket_drop.previous": "the previous day",
	"digest.finding.drawer_variance":
		"• {store}: {shift} ({from}–{to}) drawer off by {variance}.",
	"digest.finding.drawer_variance.more":
		"• {store}: and {count} other shifts with a drawer variance (see the day report).",
	"digest.finding.drawer_variance.shift": "Shift {number}",
	"digest.finding.drawer_variance.shift.unknown": "A shift",
	"digest.finding.unverified_day.unmatched":
		"• {store}: figures do not match the POS yet; this store's revenue alerts are paused.",
	"digest.finding.unverified_day.unchecked":
		"• {store}: not reconciled with the POS yet.",
	"digest.finding.zero_sales_day":
		"• {store}: no invoice on a day it was open.",
	"digest.open.title": "Still open:",
	"digest.open.auth_failed":
		"• The POS refuses the login {account} (since {date}).",
	"digest.open.sync_stale": "• {store} cannot sync (since {time} {date}).",
	"digest.open.sync_failed": "• Sync of {subject} is failing (since {date}).",
	"digest.link.ngay": "Open the day report: {url}",
	"digest.link.today": "Open Today: {url}",
	"digest.footer": "Turn off or change the channel: Settings → Alerts.",
	"correction.title": "Update to the daily digest {date}",
	"correction.intro": "After the nightly sync, the figures changed:",
	"correction.net": "• Net revenue: {net} (was {old})",
	"correction.invoices": "• Invoices: {invoices} (was {old})",
	"correction.store":
		"• {store}: {net}, {invoices} invoices (was {oldNet}, {oldInvoices} invoices)",
	"correction.attention": "Newly needs attention ({count}):",
	"alert.subject": "Operational alert from FNB Manager",
	"alert.reminder.subject": "Operational alert reminder",
	"alert.resolved.subject": "Recovered",
	"alert.auth_failed":
		"Alert: the POS refuses the login {account}. Sync of {count} stores has stopped. Update the password in .env, the GitHub secret and the Edge Function secret, then run the sync again.",
	"alert.auth_failed.stores":
		"Alert: the POS refuses the login {account}. Sync of this account's stores has stopped. Update the password in .env, the GitHub secret and the Edge Function secret, then run the sync again.",
	"alert.auth_failed.resolved":
		"Recovered: {account} logs in again, sync continues.",
	"alert.sync_stale":
		"Alert: {store} has not synced successfully for {minutes} minutes of opening time (threshold {threshold}). Today's figures may be out of date.",
	"alert.sync_stale.reminder":
		"Reminder: {store} still cannot sync (since {time} {date}).",
	"alert.sync_stale.resolved": "Recovered: {store} synced again at {time}.",
	"alert.sync_stale.previous_day":
		"{store}: yesterday had {minutes} consecutive minutes of opening time without a sync (threshold {threshold}).",
	"alert.sync_failed":
		"Alert: sync of {subject} failed while {stage} ({count} times in a row). The system will retry; if it keeps failing, run fnb status.",
	"alert.sync_failed.stage.config": "reading the configuration",
	"alert.sync_failed.stage.connect": "connecting to the POS",
	"alert.sync_failed.stage.run": "syncing the data",
	"alert.sync_failed.subject.kind": "{account} ({kind})",
	"alert.sync_failed.kind.nightly": "nightly sync",
	"alert.sync_failed.kind.backfill": "history load",
	"alert.sync_failed.kind.reconciliation": "reconciliation",
	"alert.sync_failed.kind.incremental": "intraday sync",
	"alert.sync_dispatch_failed":
		"Alert: the sync schedule could not call the sync function for {store} ({count} times). See the log of the sync-incremental Edge Function.",
	"alert.zero_sales_open":
		"{store}: open for {minutes} minutes but no invoice yet today.",
	"alert.nightly_missing":
		"Alert: the nightly sync has not succeeded in the last {hours} hours. Check the repository's Actions tab.",
	"alert.nightly_missing.resolved":
		"Recovered: the nightly sync succeeded at {time}.",
	"alert.job_failed":
		'Alert: the automated job "{workflow}" failed at {time} ({conclusion}). Open the repository\'s Actions tab for the log.',
	"alert.job_failed.workflows_active":
		"GitHub had turned some scheduled jobs off because the repository was inactive; they have just been turned on again.",
	"alert.channel_failed":
		"Alert: the {label} channel cannot send ({reason}). Check the token or link again in Settings → Alerts.",
	"alert.digest_failed":
		"Alert: the daily digest of {date} could not be built after {attempts} attempts.",
	"alert.cash_count_variance":
		"Alert: {store}, {shift} on {date}: the cash counted at the shift close is {direction} the POS figure, over the {reasons} threshold. Check the drawer; a manager can reopen the count for a recount.",
	"alert.cash_count_variance.recount":
		"Alert: {store}, {shift} on {date}: after {count} recounts the cash is still {direction} the POS figure, over the {reasons} threshold. Check the drawer and the shift's cash in and out.",
	"alert.cash_count_variance.shift": "Shift {number}",
	"alert.cash_count_variance.shift.unknown": "a shift",
	"alert.cash_count_variance.shortfall": "short of",
	"alert.cash_count_variance.surplus": "above",
	"alert.cash_count_variance.differs": "different from",
	"alert.cash_count_variance.reason.absolute": "absolute",
	"alert.cash_count_variance.reason.relative": "relative",
	"alert.cash_count_variance.reason.z_score": "z-score",
	"alert.cash_count_variance.reason.unknown": "set",
	"alert.zalo_token_failed":
		"Alert: the {token} of brand {brand} could not be refreshed. Run fnb zalo status to see its state.",
	"alert.zalo_token_failed.refused":
		"Alert: Zalo refused to refresh the {token} of brand {brand} (error code {code}). Grant it again with {command}, then check with fnb zalo status.",
	"alert.zalo_token_failed.not_configured":
		"Alert: the {token} of brand {brand} could not be refreshed because the brand's App secret is missing where the job runs. Add that secret, then run the job again.",
	"alert.zalo_token_failed.unanswered":
		"Alert: Zalo did not answer the refresh of the {token} of brand {brand}. The old token is not reused; the next run reads the state again. If it keeps failing, run fnb zalo status.",
	"alert.zalo_token_failed.reminder":
		"Reminder: the {token} of brand {brand} is still not refreshed (since {time} {date}). Run fnb zalo status to see its state.",
	"alert.zalo_token_failed.resolved":
		"Recovered: the {token} of brand {brand} was stored again at {time}.",
	"alert.zalo_token_failed.token.oa": "OA token",
	"alert.zalo_token_failed.token.developer": "Mini App developer token",
	"alert.zalo_token_failed.token.unknown": "Zalo token",
	"alert.zalo_token_failed.command.oa": "fnb zalo oa authorize",
	"alert.zalo_token_failed.command.developer": "fnb zalo zmp seed",
	"alert.oa_package_expiring":
		"Alert: the OA's {tier} package expires on {date}, {days} days left. Renew it on the OA management page so OA messages are not interrupted.",
	"alert.oa_package_expiring.last_day":
		"Alert: the OA's {tier} package expires on {date}. Renew it now on the OA management page so OA messages are not interrupted.",
	"alert.oa_package_expiring.tier.co_ban": "Basic",
	"alert.oa_package_expiring.tier.tieu_chuan": "Standard",
	"alert.oa_package_expiring.tier.tang_truong": "Growth",
	"alert.oa_package_expiring.tier.toan_dien": "Complete",
	"alert.zalo_webhook_unverified":
		"Alert: on {date} the OA webhook received {count} events with a wrong signature (threshold {threshold} a day). Check the OA secret key in the Edge Function secrets.",
	"alert.zalo_webhook_unverified.observe":
		"Alert: on {date} the OA webhook received {count} events with a wrong signature (threshold {threshold} a day). Observe mode still stores them; check the OA secret key in the Edge Function secrets before switching to enforce mode.",
	"alert.zalo_webhook_unverified.enforce":
		"Alert: on {date} the OA webhook refused {count} events with a wrong signature (threshold {threshold} a day). Check the OA secret key in the Edge Function secrets; if the key is right, someone may be sending forged events.",
	"alert.generic": "Operational alert: {rule}.",
	"alert.generic.resolved": "Recovered: {rule}.",
	"alert.footer": "Turn off or change the channel: Settings → Alerts.",
	"workflow.sync": "Nightly sync",
	"workflow.backup": "Database backup",
	"workflow.migrate": "Database update",
	"workflow.deploy_web": "Web app deployment",
	"workflow.deploy_functions": "Edge Function deployment",
	"workflow.notify": "Digest sending",
	"workflow.workflows_active": "Turning scheduled jobs back on",
	"workflow.zalo_tokens": "Zalo token refresh",
	"workflow.other": "Other job",
	"list.and": "and",
	"reason.token_invalid": "invalid token",
	"reason.unauthorized": "API key refused",
	"reason.no_credit": "no sends left",
	"reason.not_found": "chat not found",
	"reason.blocked_by_user": "the recipient blocked the bot",
	"reason.secret_missing": "secret key missing",
	"reason.sender_missing": "sender address not configured",
	"reason.permission_denied": "the API key may not send",
	"reason.account_under_validation": "e-mail account awaiting validation",
};
