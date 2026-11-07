# iPOS ecosystem around Fabi: CRM, vouchers, channels and partner feeds

As of 2026-11-07. Markers: [high] = official iPOS or Zalo page; [medium] = official but old, or third-party; [low] = inference.

## Purpose

This deep dive maps the iPOS products around the Fabi POS used by the owner's brands, so that Track C and the connector work are designed against what iPOS actually offers: CRM, customer attachment and points, e-voucher behaviour, the validation callback, ordering products, HRM, partner feeds and the missing public write API. Where the fact-check pass corrected a figure, the older one is marked outdated.

## What is verified

### Products and pricing posture

- iPOS sells FABi, FABi Manager, O2O, WebOrder, FoodHub ("Nhận đơn đa kênh"), CallCenter, CRM, HRM and more. Only FABi has a published price, 250,000 VND per store per month; the rest is by quote [high, 2026-11-05]. FABi Manager is included and already alerts on new, edited and deleted bills and shift closures [high].

### iPOS CRM

- Enabled from the Fabi CMS (Ứng dụng → iPOS Apps → iPOS CRM); connecting it auto-creates the order sources CRM, ZALO and FACEBOOK, fixed and hidden from the POS sales screen [high].
- Tiers by cumulative spend; points are a percentage of the "giá trị thanh toán" (5 % of 100,000 VND = 5,000 points, 1 point = 1 VND), redeemable across brands of the same owner; expiry undocumented [medium, 2020-08-06]. Store promotions live in the Fabi CMS, e-vouchers in CRM [high].
- E-vouchers: multi-use and unique single-use codes, automatic triggers (sign-up, bill payment, milestone, inactivity, birthday, tier upgrade); bill, item, buy-X-get-Y and free-item types; limits per member, day, store and time window; an accounting-type setting decides how the discount is reported [high, 2024-06-10].
- Issuance: Zalo and Facebook (only to customers registered through that channel), SMS (needs a Brandname), Excel by e-mail (1,000 codes per run); the only data export is Excel by e-mail [high].

### Attaching a customer; when points are credited

- On FABi the cashier taps **Thêm khách hàng** on the item screen and enters the phone; an unknown number prompts member creation; with "Cấu hình đổi điểm" set, the POS shows the member and eligible vouchers [high, 2021-12-24].
- Points are credited automatically after the bill is printed, on the amount paid, if the member was attached before payment; offline fallback is manual credit in CRM [medium: documented for the "Hội viên" token flow, 2020–2021; fact-checked].
- The check-in code ("Mã tích điểm") comes from the brand's Zalo OA chat and is scanned or typed before payment [medium, 2020]. An O2O order with a member phone attaches that member automatically [high, October 2024].

### E-voucher codes at the POS

- The code becomes **Đã sử dụng** the moment it is entered, even if no bill is printed; it is bound to the table; a named-recipient voucher attaches that member and credits points [high, 2024-06-10].
- An applied voucher locks the order; staff remove it, edit and re-apply, and a removed single-use code is burned [high, 2021]. PDA takes one voucher per order unless a CMS switch is on [high].

### Restaurant-hosted validation callback

- A multi-use e-voucher programme can carry the restaurant's own callback URL. When the cashier enters a code the POS POSTs JSON with Pos_Parent, Pos_Id, Coupon_Code, Membership_Id, Sale_Tran_Id, Created_At, Code, Date_Start, Date_End and Voucher_Order_Line[] (Item_Type_Id, Item_Id, Description, Quantity, Amount, Pr_Key, Price_Sale, Discount, Detail_State, Package_Id); the response echoes the structure plus Discount_Amount, Discount_Description and a result code. The restaurant builds and hosts it, or iPOS builds it for 1,000,000 VND per programme [high, updated 2024-06-10, payloads from 2020]. Authentication, timeouts, retry and void handling are undocumented [high].

### Zalo and ZNS connector

- CRM connects to an OA by authorising the iPOS app [medium, 2020]. For ZNS the brand creates its own Zalo developer app and enters APP ID, App Secret and OA tokens in CRM; templates are approved by Zalo; CRM fills 26 parameters including store_name, tran_id, total_amount, bill_point and voucher_code [high, 2026-04-28].
- OA Open API (ZNS by API, webhooks) is only on **Tăng trưởng** and **Toàn diện** [high, effective 01/06/2026].

### Ordering products and HRM

- **WebOrder** (ordering page; the customer becomes a member but earns points only if following the OA) and **O2O** (QR per table; prepaid needs MoMo or ZaloPay, post-paid needs CRM) are claimed free [medium]. **FoodHub** brings GrabFood, ShopeeFood, WebOrder and the MoMo online store into FABi, with a paid "Mở cổng" step of unpublished amount [high, 2025-12-15]. No iPOS-branded Zalo Mini App exists [medium].
- **HRM**: free up to 4 staff, then 150,000 to 550,000 VND per month plus 80,000 VND per extra branch [high].

### Partner feeds; no public API

- iPOS publishes no developer portal, API reference or webhook docs; partner access goes through sales or technical support [high].
- **iPOS DW – PARTNERS** (third-party notes, 2026-10-27): iPOS POSTs each invoice to a callback URL registered through support (5 retries 30 s apart) and offers a pull endpoint; no menu API; edited invoices arrive as new sales with an origin reference; membership fields not mentioned [medium].
- **Foodbook Hub** (via a loyalty vendor's guide): after a contract the brand gets an ID Token, Token Value and a Call Back URL field; orders and customers sync both ways, products one way; points and vouchers do not [medium]. Event webhooks (point redemption, last visit) are enabled by e-mailing iPOS support [medium]. Probably one partner layer plus a warehouse channel [low].

## Limits and rules

- All loyalty logic lives in CRM; the POS only identifies the member, applies codes and redeems points at a fixed rate. No documented third-party call credits points or attaches a customer to a bill.
- Points accrue only if the member is attached before the bill prints.
- A code can be "Đã sử dụng" in CRM yet appear on no final invoice; reconcile against synced invoices.
- The callback has no documented authentication: use a secret path segment, an allow-list and idempotency on Sale_Tran_Id, and answer fast.
- Most CRM pages date from 2020–2021; verify in the live CRM.

## Costs

| Item | VND | Unit |
|---|---|---|
| FABi POS | 250,000 | per store per month [high] |
| iPOS CRM | not published | per month, by quote [high] |
| Proactive OA message via CRM (iPOS fee, Dec 2020) | 55 incl. VAT | per message [medium; verify] |
| ZNS template message | 300 ex-VAT; 400 for OTP and voucher templates | per delivered message from 16/03/2026; the 200/300 schedule is outdated [high] |
| Zalo OA package, incl. VAT | Tiêu chuẩn 1,000,000; Tăng trưởng 2,500,000; Toàn diện 6,000,000 | per year; Open API and free consult allowance only on Tăng trưởng and Toàn diện [high] |
| Tin Tư vấn outside 48 h and allowance | 55 | per message [high] |
| iPOS builds the validation callback | 1,000,000 | one-off per programme [high] |
| FoodHub, "Mở cổng", Foodbook Hub, DW access | not published | by quote [high] |
## What it means for this project

1. **Identification at the till is the binding constraint.** None of the synced invoices of the owner's brands carry a customer phone today. Any reward programme starts with a cashier habit (Thêm khách hàng), and the phone has nowhere to go without iPOS CRM.
2. **Two viable architectures.** (a) CRM as system of record: points accrue in CRM, Supabase mirrors members and bills through a partner feed or posapi membership fields, redemption uses CRM e-voucher codes. (b) Own engine: points and coupons in Supabase, purchase linking through the validation callback, the DW webhook or the posapi sync with heuristic matching. (a) is lower risk; (b) stays portable to other POSes. Decided: ADR-016 and ADR-024 choose (b) as the system of record with CRM only as the till rail (the hybrid described in `ipos-loyalty-integration-design.md`).
3. **The validation callback is the only free real-time hook.** It carries Membership_Id, Sale_Tran_Id and lines, so one multi-use programme per reward type plus an Edge Function gives "identify and reward" in real time. Redemption stays two-sided: a coupon is redeemed only when the discount appears on a synced, non-voided invoice.
4. **Messaging drives cost.** Per-bill ZNS at 300–400 VND adds up; OA messages inside 48 hours are free; API messaging needs Tăng trưởng. Phase 14's channel abstraction should prefer OA inside the window, then ZNS.
5. **Build versus buy for Track B.** FABi Manager and HRM already cover bill alerts, clock-in and tasks; the staff Mini App should focus on what they lack.
6. **Channels and data model.** Configure "Kênh bán hàng" per partner channel; an ordering Mini App bypasses FABi unless pushed through Foodbook Hub or CallCenter. Members, tiers, points ledger, voucher programmes and redemptions become tenant tables; vendor ids stay per-tenant configuration.

## Checklist

- [ ] In the Fabi CMS, check Ứng dụng → iPOS Apps for whether CRM is already initialised; request the CRM quote and ask who bills ZNS sent through CRM.
- [ ] Ask iPOS support for conditions, cost and a payload sample of iPOS DW – PARTNERS and Foodbook Hub.
- [ ] After enabling CRM, attach a test member and inspect posapi payloads for membership fields.
- [ ] Create a test multi-use e-voucher with a callback to a staging Edge Function; capture the live request.
- [x] Architecture decided (hybrid, ADR-016 and ADR-024); remaining: replace the shared cashier login with per-shift accounts.
- [ ] Verify the brand OA(s), buy Tăng trưởng and submit ZNS templates with the CRM parameter names.

## Open questions

- Whether posapi exposes membership fields once CRM is connected.
- Whether the DW webhook carries membership fields, and on what terms.
- Whether Foodbook Hub's "Voucher" service allows programmatic validation or point credit.
- Which FABi POS and PDA versions the shops run; whether CRM can map a Zalo Mini App user to a member other than by phone.

## Sources

- iPOS product map: https://ipos.vn/mo-hinh/
- FABi price notice: https://ipos.vn/thong-bao-dieu-chinh-gia-thue-bao-ipos-fabi/
- Fabi CMS and POS manual: https://fabi-docs.ipos.vn/
- CRM feature table: https://huongdan.ipos.vn/docs/bang-tinh-nang-phan-mem-ipos-vn/tinh-nang-phan-mem-ipos-crm/
- Member sign-up at FABi POS: https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-ca-nhan-khach-hang/dang-ky-thanh-vien-tai-may-pos-ban-hang/
- Points by phone: https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-hanh-vi-khach-hang/tich-diem-bang-so-dien-thoai/
- Check-in code: https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/khach-hang/thu-thap-thong-tin-hanh-vi-khach-hang/thu-thap-hanh-vi-khach-hang/
- Membership policy: https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/thanh-vien/tao-chinh-sach-thanh-vien/
- E-voucher creation: https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/tao-e-voucher/
- E-voucher issuance: https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/phat-hanh-e-voucher/
- Applying a voucher at POS: https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/ap-dung-ma-voucher/
- Order locked after voucher: https://huongdan.ipos.vn/docs/htkt-khac-phuc-loi-phan-mem/ban-hang/khong-the-goi-them-mon-khi-da-su-dung-voucher-giam-gia/
- Validation callback: https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/quan-ly-evoucher/nha-hang-tu-xay-dung-he-thong-kiem-tra-ma-voucher/
- Zalo OA connection in CRM: https://huongdan.ipos.vn/docs/huong-dan-su-dung-ipos-crm/ket-noi-zalo/
- ZNS template parameters for CRM: https://huongdan.ipos.vn/docs/huong-dan-khai-bao-ket-noi-tai-khoan-zalo-cloud-account-zca-va-tao-template-zns-cho-crm-ipos-vn/iv-danh-sach-tham-so-zbs-template/
- iPOS Zalo message fee (2020): https://ipos.vn/thong-bao-ve-viec-tang-phi-khi-gui-tin-nhan-tu-ipos-crm-qua-kenh-zalo/
- Zalo OA pricing: https://zalo.solutions/oa/pricing
- ZBS Template Message price update: https://zalo.solutions/news/thong-bao-cap-nhat-cau-truc-va-don-gia-zbs-template-message/rb4ygyq8wdg7yvbue3qa7yli
- WebOrder: https://ipos.vn/web-order/
- O2O prepaid: https://huongdan.ipos.vn/docs/huong-dan-su-dung-o2o-tra-truoc/van-hanh/thao-tac-khach-hang/
- FoodHub: https://ipos.vn/ipos-foodhub
- GrabFood connection: https://huongdan.ipos.vn/docs/cac-luu-y-khi-van-hanh-giai-phap-ban-hang-online-qua-kenh-grabfood-fabi/huong-dan-dang-ki/
- CallCenter: https://ipos.vn/en/phan-mem-quan-ly-don-hang-tap-trung-ipos-callcenter/
- HRM: https://ipos.vn/en/phan-mem-quan-ly-nhan-su-ipos-hrm/
- iPOS DW partner feed (third-party notes): https://github.com/volekhanh123/beeftown-stock/pull/120
- Foodbook Hub via a loyalty vendor: https://huongdan.cnvloyalty.com/tinh-nang/cau-hinh/cong-ket-noi-du-lieu/ket-noi-ipos
- Ladiflow iPOS webhooks: https://ladipage-vietnam.gitbook.io/v5-ladiflow/tich-hop/huong-dan-tich-hop/tich-hop-ipos.md
