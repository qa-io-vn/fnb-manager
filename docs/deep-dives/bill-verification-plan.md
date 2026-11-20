# Bill verification without the POS: a plan for accurate staff-mode earning

Plan only, 2026-11-20. No code or migration is written by this document. Constraint from the owner: **nothing may depend on iPOS** (no invoice sync, no template change, no hotline answer, no voucher code). The till only prints the paper bill. Evidence comes from the bill itself and from the two people at the counter. It fits batch E's per-store `loyalty_confirmation = 'staff'` mode (read from the plan of record; its migrations 20261120500000-599999 and pgTAP 220-234 were not yet in the repository when this was written, so re-read them before item 1).

## 1. Threat model

| Trick | Who | Control | Residual |
| --- | --- | --- | --- |
| Inflated or invented amount | cashier | customer's blind reading must agree; photo reading; caps | none unless the customer colludes |
| Reuse of a bill, or the same bill via two accounts | either | dedupe key store + business date + bill no; conflicting total on a known key raises an alert; photo hash | a re-typed bill with a new number (needs sequence check) |
| Old bill, other store, other day | either | printed date and time within N minutes of server time and inside opening hours; store header tokens | none beyond a reader error |
| Own-phone or friend's phone | cashier | staff phones blocked (exists); same-member-same-staff ratio; earn and redeem by different people | a friend who is never flagged: bounded by caps |
| Edited or fake bill (colluding customer) | both | line sums and VAT arithmetic; sequence band; header tokens; tamper cues (weak) | **a good forgery passes**; bounded in đồng by caps (section 3) |
| Bill that never reached the POS (rung and voided, test print) | cashier | customer must also claim paying that amount; audits | with a willing customer it is undetectable without a POS record |
| Screenshot or gallery photo of an old bill | customer | live camera capture where the SDK allows; photo hash; freshness | a photo of a screen, if the SDK allows gallery picks |
| Rubber-stamping the confirmation | customer | blind entry (they type what they paid; staff total is not shown) | the customer who never opens the app: stays at level 1 |

## 2. Options for reading the bill

| Option | Accuracy | Fraud resistance | Latency | Cost | Needs |
| --- | --- | --- | --- | --- | --- |
| a. Staff types the total (today) | exact, if honest | none | 0 | 0 | nothing |
| b. Customer types the total blind, must equal staff's | exact | high against inflation; low against collusion | the customer's tap | 0 | customer app |
| c1. Photo, on-device OCR (tesseract.js) | about 80-90% per field on thermal paper (estimate); poor digits | medium | 5-15 s on mid phones | 0 | a package of several MB, weak fit for Mini App limits; rejected as the main reader |
| c2. Photo, Edge Function calling a vision model | about 95-99% per field on a clear photo (estimate, to be measured on the golden set) | high | 2-6 s | roughly 100-300 ₫ a photo (estimate, verify against the price list) | an API account and budget |
| d. Printed QR on the bill | n/a | n/a | n/a | n/a | iPOS template: **out of scope**; if a QR or lookup code happens to be on the bill, a local decoder may read it as an extra field |
| e. Combination b + c2 + bill checks | best | best available without a POS | a few seconds | about 300 ₫ a bill with two photos (about 90,000 ₫ a day at 300 bills) | as above |

Vision-model rules: the Edge Function returns schema-validated JSON only (no tools, so text printed on a bill cannot steer it); every field has a `legible` flag; line items summing to the total is a built-in self-check; a budget cap switches to sampling. Tests use a mock reader (`BILL_READER=mock`), never a real call. Photos are bills, not customers, but may show hands or faces: stored in a private tenant bucket, signed URLs for managers only, deleted after 90 days (knob), only the hash and the reading kept. The consent text names the reader as a processor.

## 3. Recommended design: the evidence ladder

Two independent readings that must agree, then clean bill checks.

| Level | Evidence | Ledger state | Spendable | Rules |
| --- | --- | --- | --- | --- |
| 0 typed | staff typed total only | pending | after 24 h without dispute | allowed only up to a low amount cap; above it a manager approves (existing request flow); off by default once cameras work |
| 1 one reading | staff photo read, or one typed reading plus customer silence | pending | after 12 h | customer notification with "Không đúng"; a dispute reverses |
| 2 two agreeing | staff reading and the customer's blind total (or the customer's own photo), equal within the rounding knob | confirmed at once | at once | disagreement means no earn and a queue item |
| 3 two agreeing and clean checks | level 2 plus header tokens, number sequence band, time freshness, arithmetic, no photo-hash hit | confirmed at once | at once | skipped by routine review; 2% random audit |

Any failed check holds the earn in the manager queue (reason keys on the existing `loyalty_queue`). No answer within `bill_unconfirmed_hours` (default 24) at level 0 or 1 reverses the earn with a clawback row and an alert. An audit failure reverses and counts against the staff member.

**Dedupe key:** store + business date + bill number (leading zeros ignored, like path C). A second claim with a different total on a known key is a high-severity alert.

**Checks without a POS.** Per-store profile: header tokens (name, address, tax code), the bill number format and reset period, opening hours. Sequence: within a day the number rises with time; flag a number below one already seen earlier or beyond the last seen plus the store's own hourly rate times elapsed time (gaps are normal, since only members' bills are scanned).

**Caps that bound the loss in đồng.** A fake earn costs at most the cap on its amount times the reward rate. With illustrative numbers (a stamp worth about 4,000 ₫; 3 earns per member per day, exists): one colluding member costs at most 12,000 ₫ a day; a staff cap of 25 unreviewed level 0-1 earns per shift and an amount cap per earn bound the staff total near 100,000 ₫ a shift, and the earn-by-one, redeem-by-another rule and the weekly redemption cap per member stop a quiet build-up. The owner sets the real rates; the cap is a number in the config, and an alert fires at 70% of it.

**Anomaly controls:** amount outliers against the store's rolling median (MAD), earns per hour against the staff baseline, earns per staff against peers, share of one staff's earns that went to one member, customer disagreement and dispute rate per staff, bills by level, sequence flags.

**Fit with batch E.** In `staff` mode an earn is written pending at capture (existing `pending` and `confirm`/`clawback` ledger rows); the evidence level only decides when the confirm row is written. `pos_sync` mode is unchanged. If synced invoices exist, a later shadow job may link `bill_captures.invoice_id` and mark the bill "also seen on the POS"; nothing needs it, and the link must stop path A or C from earning the same invoice twice.

**Blocker found in the schema:** `loyalty_ledger` requires `invoice_id` on earn, confirm and clawback rows, has the `matched_path` check ('A' to 'D') and a unique earn per invoice. A bill earn needs a `bill_id` instead.

## 4. Data model, API, screens, knobs (names only)

- **Tables:** `bill_captures` (store, staff, membership, photo path, photo hash, reader output, bill no, date, time, total, lines, flags, dedupe key, level, state), `bill_confirmations` (source customer or staff, entered total, optional reading), `bill_store_profiles`, `bill_audits`. Ledger: add nullable `bill_id`, relax the invoice check to "invoice or bill", a unique earn per bill, `matched_path` 'E'. State machine: captured, read, awaiting_customer, agreed, disputed, timed_out, confirmed, queued, reversed.
- **Functions:** `staff_submit_bill`, `customer_confirm_bill`, `customer_dispute_bill`, `app.bill_evaluate`, `app.bill_settle`, `app.bill_expire_pending` (job), `bill_anomaly_report`; Edge Function `read-bill`; a retention job for the bucket.
- **Staff Mini App:** "Quét hóa đơn" (camera with a frame guide, retake, read-back of the fields, flags; no editing of the reading, "nhập tay" drops to level 0). **Customer Mini App:** "Xác nhận hóa đơn" card (blind total, optional photo, "Không đúng"). No receipt-QR screen.
- **Web:** evidence level on the ledger and member detail; the Bills view with the photo for managers; an anomalies view (staff against peers, levels, disagreements); alert rules in Cảnh báo.
- **Knobs per store or programme:** `bill_evidence_required_level`, `bill_typed_amount_cap`, `bill_manager_approval_above`, `bill_amount_tolerance`, `bill_time_tolerance_minutes`, `bill_unconfirmed_hours`, `bill_staff_shift_cap`, `bill_audit_sample_pct`, `bill_photo_retention_days`, `bill_reader_budget_per_day`, `bill_reader_mode` (off, mock, live, sample).

## 5. Phases (simple first)

| # | Work | Areas | Tests | Accept when | Owner? |
| --- | --- | --- | --- | --- | --- |
| 1 | Ledger `bill_id`, `bill_captures`, dedupe key, typed level 0 with amount cap, approval above threshold, staff shift cap | migrations after batch E's, `staff_record_checkin` | boundaries on caps and amounts; decision table cap x approval; state transitions; RLS and refusal of cross-tenant writes; regression: paths A to D unchanged | a typed earn is pending, capped, deduped | no |
| 2 | Customer blind confirmation (human-human level 2), dispute, timeout reversal | customer app card, functions, job | equivalence (equal, within tolerance, different); transitions; replay and wrong-member security; e2e with a mocked SDK | two agreeing totals confirm at once; silence reverses at the deadline | no |
| 3 | Anomaly report, manager queue, random audit, alerts | SQL, web view, notify rules | seeded outlier and peer cases; false-positive rate on normal data | each trick in section 1 that caps can catch is flagged | owner sets caps |
| 4 | Live camera capture, private bucket, photo hash, retention, mock reader | staff app, storage, Edge Function | mocked camera API; duplicate hash; retention deletes; no real calls | a photo yields a mock reading and a level 1 earn | no |
| 5 | Bill checks and store profiles (tokens, sequence, time, arithmetic) | `app.bill_evaluate`, web settings | boundary on minutes and sequence; decision table of checks x level | level 3 only when all checks pass | owner supplies header text and opening hours |
| 6 | Real vision reader, budget cap, sampling, golden-set accuracy report | Edge Function | schema and injection tests against the mock; accuracy on 50-100 owner photos | per-field accuracy at or above the owner's target | **owner: API account and budget**; default: items 1-5 work without it |
| 7 | Customer's own photo as second reading, optional decoder for any QR on the bill | customer app | agreeing and disagreeing photos | level 2 without typing | no |
| 8 | Optional shadow check if synced invoices exist | job | no double earn | never required | no |

## 7. As built (2026-11-21)

Phases 1 to 3 are built in migrations 20261120500000-20261120520000 with pgTAP 220-226, the three apps and the docs (schema.md, api.md, user-guide.md, loyalty/cashier-script.md, ADR-043). Decisions and deviations from sections 3 and 4:

- **Path letter E** and `loyalty_ledger.bill_id`; the invoice check reads "invoice or bill". The earn is written pending when staff record the bill; the evidence level only decides when the confirm row (reason `bill_confirmed`) is written, as planned.
- **Knob placement**: per store, in `loyalty_store_settings`, next to the mode (`confirmation`), not per programme. `bill_typed_amount_cap` and `bill_manager_approval_above` were merged into `bill_manager_approval_above` (a typed bill above it waits for a manager) plus a hard `max_bill_amount`. `bill_staff_shift_cap` counts a staff member's level 0-1 bills per business day (the POS-free store has no shift record); `bill_reader_budget_per_day` is left for phase 6; `bill_reader_mode` holds `off` or `mock` only.
- **Silence**: section 3's table says a level 0 bill becomes spendable after 24 h without dispute, while its text and phase 2 say silence reverses. Built as a knob, `bill_silence_outcome`, defaulting to `reverse`; owners may choose `confirm`. **Owner question.**
- **Required level**: `bill_evidence_required_level` defaults to 2 (two agreeing readings). An owner may set 0 to confirm the staff reading at once, which is the user's first request ("confirmed at once") and stays bounded by the caps and audits.
- **Manager queue**: its own lists (`staff_bill_queue`, `staff_decide_bill`, `staff_close_bill_audit`) instead of `loyalty_queue`, whose path and reason checks and web readers are built around invoices. A manager may not approve a bill they recorded; an owner may.
- **Customer blind confirmation**: one answer per bill; a disagreement queues it at once (no second try), so the answer never leaks the staff total.
- **Counter claims** (the user's self-claim request): the customer's total is the first reading; a staff member types the total read from the bill blind as the second. Auto-approval up to a small amount is an owner-accepted level 0 confirmation with its own daily count. A counter QR lives `counter_code_ttl_seconds` (90) plus 120 s to type; printed QRs are not offered because they would allow remote claims.
- **Earn by one, redeem by another**: `staff_confirm_redemption` refuses `same_staff` when the confirming staff member recorded a bill for that member the same business day. The weekly redemption cap per member is not built (open).
- **Alerts**: one rule, `loyalty_staff_anomaly`, with kinds (cap warning at 70 %, cap reached, a critical bill conflict, dispute, timeout, reversal, failed audit, shadow mismatch).
- **Anomaly report**: `bill_anomaly_report` per store, day and staff member with the flags peer_outlier, disagreements, disputes, timeouts, one_member, amount_outliers (store median + 5 MAD over the range), audit_failed and burst (most bills in one hour against the staff member's own hourly average).
- **Phase 8 early**: the shadow check (`app.loyalty_shadow_reconcile`) runs after a sync only where staff mode and `shadow_reconcile` are on, links `bill_captures.invoice_id` by bill number and flags; a linked invoice cannot earn on paths A to D.
- **Extension points for phases 4-8**: `bill_captures.photo_path`, `photo_hash`, `reading`, `printed_at`, `lines`, `flags`; `bill_confirmations.source = 'reader'` with `reading`; `evidence_level` 1 and 3; `bill_reader_mode`; `bill_photo_retention_days`.

## 6. Risks and open questions

1. What reward value per stamp or point, and what loss per day is acceptable? The caps follow from it.
2. Will the owner fund a vision account (about 1-3 million ₫ a month at current volume, an estimate)?
3. Can the Mini App SDK be limited to live camera capture, and is the camera permission granted? To prove in the sandbox.
4. Who audits, how often, and may photos be kept 90 days? The consent text needs the reader named.
5. Do customers who do not open the app matter? They stay at level 1, with slower spending.
6. Is a forged bill by a colluding pair acceptable as a bounded residual loss, with no way to detect it without a POS record?
