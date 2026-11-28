# Mẫu tin ZBS · ZBS template drafts and submission package

The generic drafts of the customer message templates (#280, FR-NOT-40, FR-CMP-07) and what the owner submits with them in the ZBS console. The Vietnamese texts are what the customer reads; the English around them is for the owner and the reviewer of this repository. The drafts are generic: the brand-specific versions (the OA's name is added by Zalo, the logo is the brand's) live only in the ZBS console, and their template ids reach the system as per-brand configuration rows, never as code.

The same texts are the registry in `packages/notify/src/customer/templates.ts` (`ZBS_TEMPLATE_DRAFTS`); the unit test `notify:unit/customer/templates` fails when a draft below and the registry differ, when a body names a parameter that is not registered, or when a body breaks the content checklist.

## Content checklist · Danh sách kiểm tra nội dung

Every draft passes these before it is submitted:

1. **Vietnamese with full diacritics** («Chào», «hóa đơn», «ưu đãi»), the spelling of the registry («hóa đơn», «hủy», «tùy»).
2. **No link and no phone number in the body.** Links go only in the call-to-action button, and the only button opens the brand's customer Mini App, which costs nothing per message (a button to one's own Mini App inside Zalo is free; see [the deep dive](../deep-dives/zalo-oa-and-messaging.md#costs)).
3. **Parameters registered.** Every `<name>` in a body is a parameter of the registry, with the type and maximum length below; the name in the ZBS console is exactly the registry name, so the dispatcher's `template_data` keys match without a mapping.
4. **The Voucher layout for any code.** Zalo requires its Voucher layout whenever a discount code is shown, so the code goes only in `voucher`.
5. **No promotion in a transaction or customer-care template.** Points, a reward the member chose and an expiry are service messages; birthday and win-back are drafted as after-sales templates for the reviewers' decision only, and are otherwise left to manual OA broadcasts within their caps.
6. **No brand name in the drafts.** The console version adds the OA's own name; this repository uses only `brand-1` style keys.

## The submission package · Hồ sơ gửi duyệt

For each brand, in the ZBS console of the brand's ZBS account (linked to the brand's verified OA on the Tăng trưởng package):

| Item | What to submit |
| --- | --- |
| Logo, light | The brand logo on a transparent or white background, PNG, at the size the console asks for; no QR code, phone number or slogan in it |
| Logo, dark | The same logo prepared for a dark background (light strokes), same size and format |
| Template name | `<brand key> · <purpose>`, for example `brand-1 · points_confirmation`, so the console list maps back to the registry |
| Tag | The tag in each section below (Tag 1 transaction, Tag 2 customer care, Tag 3 promotion) |
| Layout | Text, or Voucher for `voucher` |
| Title and body | Exactly the Vietnamese below, parameters in the console's `<name>` form |
| Parameters | Name, type and maximum length from the table of each section; the sample values are for the reviewer's preview |
| Button | One call-to-action, the label below, opening the brand's customer Mini App |
| Note to the reviewer | The category question below, once per brand |

### The category question to ask with the submission

Asked once per brand in the note to the reviewer, and the answer recorded in [roadmap.md section 11](../roadmap.md#11-open-questions):

> Cửa hàng ghi nhận điểm và đổi ưu đãi tại quầy (máy POS), không phải trên Zalo. Xin xác nhận: mẫu «Xác nhận tích điểm» và «Ưu đãi đã sẵn sàng» có được duyệt theo loại Giao dịch hoặc Chăm sóc khách hàng không? Mẫu có mã ưu đãi dùng bố cục Voucher có đúng không? Mẫu «Chúc mừng sinh nhật» và «Lâu rồi chưa gặp bạn» có được duyệt là tin hậu mãi, hay phải gửi bằng tin truyền thông (broadcast)?

*(The shop records points and redeems rewards at the till, not on Zalo. Please confirm whether "points confirmation" and "reward ready" are accepted as transaction or customer-care templates; whether the template with a code must use the Voucher layout; and whether "birthday" and "win-back" are accepted as after-sales messages or must go as broadcasts.)*

## Drafts · Bản nháp

Which message kind uses which template (in order of preference; the first approved one of the brand's OA is used, see `app.customer_template_purposes`):

| Message kind | Event | Templates |
| --- | --- | --- |
| `points_confirmed` | an earn credited stamps or points | `points_confirmation` |
| `coupon_issued` | a reward was held for the member (a redemption) | `voucher`, else `coupon_issued` |
| `voucher_expiring` | a held reward ends within `voucher_expiring_hours` | `voucher` |
| `expiry_reminder` | points or stamps expire within `expiry_reminder_days` | `expiry_reminder` |
| `birthday` | sent only when the reviewers accept it and the owner switches promotions on | `birthday` |
| `win_back` | no earn for `win_back_days`, same conditions | `win_back` |
| `takeaway_ready` | a takeaway order of a member's Zalo account turned ready at the counter (C17, ADR-072); not after 22:00 | `order_ready` |
| `order_cancelled` | the shop cancelled a member's order that was paid; queued five minutes on, and replaced by `order_refunded` when the money goes back in that time (C12, ADR-073) | `order_cancelled` |
| `order_refunded` | a member's refund went back, except cash handed back at the counter (C12, ADR-073) | `order_refunded` |

### `points_confirmation` · Xác nhận tích điểm

Tag: customer_care · Layout: text · Button: «Xem điểm»

```text
Chào <customer_name>, hóa đơn <bill_no> tại <store_name> đã được ghi nhận. Bạn vừa nhận <points> điểm và <stamps> dấu. Mở ứng dụng thành viên để xem số dư và ưu đãi của bạn.
```

| Parameter | Type | Max length | Sample |
| --- | --- | --- | --- |
| `customer_name` | name | 30 | Nguyễn Văn An |
| `bill_no` | code | 30 | 001234 |
| `store_name` | text | 60 | Cửa hàng 1 |
| `points` | number | 10 | 6 |
| `stamps` | number | 10 | 1 |

### `coupon_issued` · Ưu đãi đã sẵn sàng

Tag: customer_care · Layout: text · Button: «Xem ưu đãi»

```text
Chào <customer_name>, bạn đã đổi thành công <reward_name>. Ưu đãi được giữ cho bạn đến <expires_at>. Mở ứng dụng thành viên và đưa mã cho thu ngân khi thanh toán.
```

| Parameter | Type | Max length | Sample |
| --- | --- | --- | --- |
| `customer_name` | name | 30 | Nguyễn Văn An |
| `reward_name` | text | 60 | Một ly nước miễn phí |
| `expires_at` | text | 30 | 21:00 20/11/2026 |

### `voucher` · Mã ưu đãi của bạn

Tag: transaction · Layout: voucher (the code in the voucher block) · Button: «Mở ví ưu đãi»

```text
Chào <customer_name>, đây là mã <voucher_code> cho ưu đãi <reward_name>. Đưa mã cho thu ngân trước khi thanh toán. Mã dùng một lần và hết hạn lúc <expires_at>.
```

| Parameter | Type | Max length | Sample |
| --- | --- | --- | --- |
| `customer_name` | name | 30 | Nguyễn Văn An |
| `voucher_code` | code | 30 | AB12CD34 |
| `reward_name` | text | 60 | Một ly nước miễn phí |
| `expires_at` | text | 30 | 21:00 20/11/2026 |

### `expiry_reminder` · Nhắc hạn điểm

Tag: customer_care · Layout: text · Button: «Đổi ưu đãi»

```text
Chào <customer_name>, bạn có <points> điểm và <stamps> dấu sẽ hết hạn vào ngày <expires_at>. Mở ứng dụng thành viên để đổi ưu đãi trước khi hết hạn.
```

| Parameter | Type | Max length | Sample |
| --- | --- | --- | --- |
| `customer_name` | name | 30 | Nguyễn Văn An |
| `points` | number | 10 | 6 |
| `stamps` | number | 10 | 1 |
| `expires_at` | text | 30 | 21:00 20/11/2026 |

### `birthday` · Chúc mừng sinh nhật

Tag: customer_care (after-sales, for the reviewers' decision) · Layout: text · Button: «Xem quà»

```text
Chào <customer_name>, chúc bạn một sinh nhật thật vui. Mở ứng dụng thành viên để xem món quà dành riêng cho bạn.
```

| Parameter | Type | Max length | Sample |
| --- | --- | --- | --- |
| `customer_name` | name | 30 | Nguyễn Văn An |

### `win_back` · Lâu rồi chưa gặp bạn

Tag: customer_care (after-sales, for the reviewers' decision) · Layout: text · Button: «Xem ưu đãi»

```text
Chào <customer_name>, đã <inactive_days> ngày bạn chưa ghé quán. Mở ứng dụng thành viên để xem ưu đãi đang chờ bạn.
```

| Parameter | Type | Max length | Sample |
| --- | --- | --- | --- |
| `customer_name` | name | 30 | Nguyễn Văn An |
| `inactive_days` | number | 5 | 45 |

### `order_ready` · Món mang đi đã xong

Tag: transaction · Layout: text · Button: «Xem đơn»

```text
Chào <customer_name>, đơn <order_no> tại <store_name> đã xong, hẹn lấy lúc <pickup_time>. Mời bạn ra quầy nhận món.
```

| Parameter | Type | Max length | Sample |
| --- | --- | --- | --- |
| `customer_name` | name | 30 | Nguyễn Văn An |
| `order_no` | code | 10 | #007 |
| `store_name` | text | 60 | Cửa hàng 1 |
| `pickup_time` | text | 5 | 15:30 |

### `order_cancelled` · Đơn đã hủy

Tag: transaction · Layout: text · Button: «Xem đơn»

```text
Chào <customer_name>, đơn <order_no> tại <store_name> đã bị hủy. Quán sẽ hoàn <amount> đồng cho bạn theo cách bạn đã trả. Mở ứng dụng để xem chi tiết.
```

| Parameter | Type | Max length | Sample |
| --- | --- | --- | --- |
| `customer_name` | name | 30 | Nguyễn Văn An |
| `order_no` | code | 10 | #007 |
| `store_name` | text | 60 | Cửa hàng 1 |
| `amount` | number | 12 | 45000 |

### `order_refunded` · Đã hoàn tiền

Tag: transaction · Layout: text · Button: «Xem đơn»

```text
Chào <customer_name>, quán đã hoàn <amount> đồng cho đơn <order_no> tại <store_name> ngày <refund_date>, theo cách bạn đã trả. Mở ứng dụng để xem chi tiết.
```

| Parameter | Type | Max length | Sample |
| --- | --- | --- | --- |
| `customer_name` | name | 30 | Nguyễn Văn An |
| `amount` | number | 12 | 45000 |
| `order_no` | code | 10 | #007 |
| `store_name` | text | 60 | Cửa hàng 1 |
| `refund_date` | text | 10 | 28/11/2026 |

## Parameters at send time

The outbox never stores these values (NFR-PRV-02): `app.claim_next_customer_message` resolves them for the dispatcher at the moment of sending (`app.customer_message_parameters`), and the dispatcher passes them to ZBS as `template_data` and forgets them.

| Parameter | Source | When it is missing |
| --- | --- | --- |
| `customer_name` | `customers.name` | «Quý khách» |
| `points`, `stamps` | the counts queued with the event | 0 |
| `bill_no` | the receipt number of the earn's invoice | the message fails as `missing_parameter`; the event stays in the app |
| `store_name` | the store of the earn, the hold or the event | `missing_parameter` |
| `reward_name`, `voucher_code` | the held reward and its code | `missing_parameter` |
| `expires_at` | the end of the hold (`HH:MM DD/MM/YYYY`) or the expiry day (`DD/MM/YYYY`), in the tenant's time zone | `missing_parameter` |
| `inactive_days` | the tenant's `win_back_days` | 0 |
| `order_no` | the native order's number as the counter calls it (`#007`); for an order cancelled before it had one, the time it was placed (`HH:MM`) | `missing_parameter` |
| `pickup_time` | the order's pick-up time, else when it turned ready (`HH:MM`, the store's time zone) | `missing_parameter` |
| `amount` | the dong queued with the event: the refund due of a cancelled order, or the refund that went back | 0 |
| `refund_date` | the day the refund went back (`DD/MM/YYYY`, the store's time zone), queued with the event | `missing_parameter` |

## Per-brand configuration · Cấu hình theo thương hiệu

The approved template ids are rows of `zbs_templates` (phase 13): one row per OA and purpose, with the console's template id, the tag and the `approval_state` (`draft`, `pending_review`, `approved`, `rejected`, `disabled`). Only an `approved` row is ever used. The owner keeps the ids outside the repository and writes them as `postgres` on the owner's machine, for example for the OA of `brand-1`:

```sql
insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
select o.tenant_id, o.id, '<template id from the console>', 'customer_care', 'points_confirmation', 'pending_review'
from public.oas o join public.brands b on b.id = o.brand_id
where b.brand_key = 'brand-1' and b.tenant_id = '<tenant id>';
```

After the console shows the decision, the owner records it on the row (`approval_state = 'approved'` or `'rejected'`), and sending starts only once the tenant's `app.customer_message_settings.zbs_enabled` is switched on as well ([operations.md](../operations.md)).

## Approval record · Kết quả duyệt

| Brand | Template | Submitted | Decision | Recorded |
| --- | --- | --- | --- | --- |
| brand-1 | points_confirmation | not yet | | |
| brand-1 | coupon_issued | not yet | | |
| brand-1 | voucher | not yet | | |
| brand-1 | expiry_reminder | not yet | | |
| brand-1 | birthday | not yet (reviewers' decision) | | |
| brand-1 | win_back | not yet (reviewers' decision) | | |
| brand-1 | order_ready | not yet | | |
| brand-1 | order_cancelled | not yet | | |
| brand-1 | order_refunded | not yet | | |

The decision is read in the ZBS console by the owner (#16); a rejected template is corrected here first, then resubmitted, because an approved template can no longer change.
