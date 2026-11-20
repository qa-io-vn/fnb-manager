# Join standee at the till: benchmark and to-do

Written 2026-11-20 from a photo of another café's counter standee (HOUSE OF HOW). It feeds the standee work in #267 and the join flow of phases 18 and 19. The photo is a reference for our own design, not something to copy: our standee uses our own brand, wording and art.

## 1. What the standee does

| Element | What it shows | Why it works |
|---|---|---|
| Headline | "THÀNH VIÊN MỚI / ƯU ĐÃI MỚI" | Says who it is for and that there is something in it, in four words |
| Offer badge | "GIẢM NGAY 5%" | One concrete benefit, stated as an immediate discount, not points |
| One QR | A Zalo QR with the logo in the middle, caption "Quét QR để gia nhập HOUSE OF HOW" | A single action: scan, and you are in the club. The caption names the club, not the app |
| Brand line | "HOW IS HERE" with "Zalo OA" marked on it | Ties the QR to the brand's Official Account |
| Placement | Table-top stand at the till, beside the POS screen and the menu | Seen while paying, which is when a customer is willing to act |

## 2. How it maps to what we have

- **The QR target.** Our two routes already exist: the Mini App join (`apps/zalo-customer`, store deep links) and the OA follow + request-user-info form (#19a). The standee should use one of them with the store parameter, so a join is attributed to the till.
- **The offer.** Our programme design offers 2 welcome stamps, not a percentage discount (`docs/deep-dives/loyalty-programme-design.md`). A "5% off the first order" needs a decision, because:
  - a discount is a voucher on the iPOS side, so it depends on the hotline answers about how a voucher is applied and called back;
  - the reward catalogue caps any discount at 50% and allows no cash-like reward, so 5% is within the rule;
  - the Sở Công Thương 100 M₫ threshold and the open question on welcome gifts apply (roadmap §11).
- **Consent wording.** Anything printed on a standee that collects a phone number must carry the consent wording, with marketing never pre-ticked (roadmap week 9 legal read).

## 3. To-do (added to the plan)

Simple first; the owner decisions are marked.

1. **Owner decision:** welcome offer type: 2 welcome stamps (current design), a first-order discount (5% like the benchmark), or both. The answer sets the reward rule.
2. **Owner decision:** QR target: Mini App join or OA follow. Recommended: the Mini App join, with the OA follow offered right after (already in the design).
3. **Standee template** (#267): A5 table-top, vi first, one headline, one badge, one QR with the store parameter, a short consent line, our brand. Generate the QR per store from the existing standee code in `apps/zalo-customer` and `packages/zalo-mini`.
4. **If a first-order discount is chosen:** add a welcome reward rule (one per customer, first confirmed order, matched like any other redemption) with pgTAP, e2e and security tests, including the abuse case of a second account on the same phone.
5. **Measure it:** the "joins per store per week" and member-attached share cards already exist; add the join source (standee QR vs cashier "Thêm khách hàng") so the standee's effect can be compared before and after.
6. **Cashier script:** one line pointing to the standee ("quét mã trên bàn để nhận ưu đãi"), in `cashier-script.md` and `sop-them-khach-hang.md`.
7. **Legal read** covers the standee wording and the welcome offer (roadmap week 9; #15/#49).

Items 3 to 6 can start once items 1 and 2 are decided.
