# Mẫu hóa đơn in · Receipt template guide

How to set up the POS custom receipt template so that every customer can still be identified from the receipt (#235, FR-LOY-29, path C of [the loyalty design](../deep-dives/ipos-loyalty-integration-design.md)). Changing the template in the POS is the owner's step (#14); this guide says what to put in it and how to test it. Vietnamese labels are what the receipt prints; the English beside them is their meaning.

This page is generic. The Mini App id and the store codes are configuration: they never appear in the repository, and the printed, tenant-specific template is kept with the owner's private records.

## Placeholders to use · Chỗ điền trong mẫu

The POS custom template fills a placeholder in braces when it prints (recorded from the POS manual and the owner on 2026-11-07; re-check them in the template editor, see [the probe](#the-probe--kiểm-tra-trong-trình-sửa-mẫu)).

| Placeholder | Print it? | Where and how |
| --- | --- | --- |
| `{tran_no}` | **Yes, large** | Near the top, under the store name, on its own line in bold and about twice the normal size: «Số hóa đơn: `{tran_no}`» (*bill number*). A customer types this number to claim a bill, and staff read it aloud when matching. |
| `{customer_point}` | Optional | Near the total: «Điểm tích lũy: `{customer_point}`» (*points collected*), only when a member is attached. It shows the POS member points, which can differ from the stamps of the shop's own programme; leave it out if that may confuse. |
| `{customer_phone}` | **No**, or masked | Leave it out. A receipt is left on tables and thrown away; a full phone number on it is personal data in the open. Print it only if the POS masks it (for example through a setting such as «Bảo mật thông tin khách hàng») and the test receipt shows the mask. |

Keep on the receipt what a claim needs: the bill number, the date and time of sale, and the total paid. Never add a customer's name.

## Bill number in the claim · Số hóa đơn khi khách gửi

The customer app asks for the bill number, the amount and the date. The bill number restarts every day at some stores and every year at others (the store setting «Đánh số hóa đơn» on Cài đặt → Cửa hàng), so the number alone is not unique: the date and the store always go with it.

## Per-bill claim QR · Mã QR gửi hóa đơn

When the template can print an image whose address contains the bill number, a QR code under the total lets the customer open the claim with the number already filled in. The link uses the Mini App's deep-link form:

```text
https://zalo.me/s/<mini app id>/?store=<store code>&bill={tran_no}
```

- `<mini app id>` and `<store code>` are filled in only on the printed template, never in this repository.
- The template prints the QR as an image; the image address is a QR picture of the link above with `{tran_no}` inside it. The link carries only the store code and the bill number, never a customer's data.
- Under the QR, print one line: «Quét để tích điểm cho hóa đơn này» (*scan to collect points for this bill*).

## The probe · Kiểm tra trong trình sửa mẫu

Run once in the POS template editor before the capture week (#14):

1. Add a test line «Số hóa đơn: `{tran_no}`» in bold and large near the top; save and print a test receipt. Does the number print, large enough to read at arm's length?
2. Add an image whose address contains `{tran_no}` (the QR above). Print a test receipt. Does the image print, and does a phone camera open the link with the real bill number in it (not the text `{tran_no}`)?
3. If `{customer_phone}` is kept, does it print masked?

Record the answers here as **supported** or **not supported**, with the date, and without any identifier, store code, Mini App id or receipt photo.

| Check | Result | Date |
| --- | --- | --- |
| `{tran_no}` printed large near the top | not run yet | — |
| QR image with `{tran_no}` in its address | not run yet | — |
| `{customer_phone}` masked | not run yet | — |

## Fallback · Khi mẫu không in được QR

If the image does not render or keeps `{tran_no}` as text, leave the QR out and print the bill number only, large, as above. The customer then opens the shop's Mini App and types the bill number, the amount and the date; staff can also record the customer at the till in the staff app. Nothing else in the programme depends on the QR.
