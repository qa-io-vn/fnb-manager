# Legal and regulatory requirements (Vietnam)

Status: research draft, 2026-11-07. Verified facts cite sources; inferences are marked.

## 1. Personal data: PDPL 2025, Decree 356/2025, Decree 330/2026

Decree 13/2023 no longer applies. The Law on Personal Data Protection 91/2025/QH15 took effect on 1 January 2026, detailed by Decree 356/2025/ND-CP (same date) and sanctioned by Decree 330/2026/ND-CP (from 19 August 2026).

**Consent.** Consent must be explicit, specific, per purpose and verifiable; silence or pre-ticked boxes are not consent (PDPL Art. 9). The controller must store the consent and prove it in a dispute (Decree 356 Art. 6). Marketing use needs its own consent and the customer can stop advertising at any time (PDPL Art. 28). Fines: 30–50 million VND for processing without valid or logged consent, 50–70 million VND for treating silence as consent or continuing after a stop request (Decree 330 Art. 43).

**Rights and deadlines.** Access, correction, deletion, restriction, objection, withdrawal. First response within 2 working days; deletion within 20 days (30 with a processor); breach notice to A05 within 72 hours; records of breaches kept 5 years.

**Dossiers and DPO.** A processing impact assessment is due to A05 (Ministry of Public Security) within 60 days of starting processing (Art. 21) and a transfer impact dossier within 60 days of the first cross-border transfer (Art. 20). Supabase in Singapore and GitHub count as cross-border storage. Dossiers are updated every six months. A DPO needs a college degree, two years' experience and training (Decree 356 Art. 13).

**Small-business relief (Art. 38; Decree 356).** Household businesses and micro-enterprises are not required to file dossiers or appoint a DPO; small enterprises and start-ups may defer until 31 December 2030. The relief is lost if the business sells data-processing services, directly processes sensitive data (Decree 356 now classes online activity history as sensitive) or reaches 100,000 data subjects cumulatively.

**Penalties.** General cap 3 billion VND per organisation; cross-border violations up to 5% of prior-year revenue; data trading 2–10 times the proceeds; individuals pay half.

*Inference:* a two-store tea and coffee business with a few thousand members and only phone, name, Zalo ID and purchase history is almost certainly inside the exemption. What it must still do: a Vietnamese privacy notice, per-purpose consent capture with evidence, an opt-out, rights handling and a breach runbook.

## 2. Promotions: Commercial Law, Decree 81/2018, Decree 128/2024

Points, vouchers, discounts and buy-one-get-one are all promotions. The decisive classification:

- **Loyalty programmes (Art. 14)**: rewards based on purchase quantity or value via cards, receipts or an app. Must be **notified** to the provincial Sở Công Thương at least 3 working days before launch (Art. 17, via the National Public Service Portal), **unless** total prize/gift value is under 100 million VND or sales run only on e-commerce platforms (Decree 128/2024, effective 1 December 2024). The 50% value cap does not apply to loyalty rewards. Cards/app must show programme name, customer identity and purchase quantity/value.
- **Discounts (Art. 10)**: max 50% of the immediately preceding price (100% only in state-run concentrated programmes), max 120 discount days per item per year; no notification needed.
- **Vouchers (Art. 11)** and **free gifts (Arts. 8–9)**: value capped at 50% of the unit price; no notification needed.
- **Lucky draws (Art. 13)**: registration required, results within 45 days. Avoid.

## 3. E-invoices: Decrees 123/2020, 70/2025, 254/2026

Decree 70/2025 (1 June 2025) made cash-register e-invoices connected to the tax authority mandatory for household businesses with revenue of 1 billion VND or more in F&B. Decree 254/2026 (issued 30 June 2026, effective 1 July 2026, with Circular 91/2026/TT-BTC) replaces Decrees 123/2020 and 70/2025. Direct-to-consumer sectors including "ăn uống, nhà hàng" use cash-register e-invoices; the 1 billion VND threshold remains for household businesses (Art. 6). Content: seller details, goods, unit price, quantity, amount, issue time, tax-authority code or lookup data, a link or QR for the buyer; buyer details only on request, otherwise "Bán cho người tiêu dùng". Lump-sum tax ended on 1 January 2026 and Decree 141/2026 raised the tax-free household threshold to 1 billion VND.

Discounts and promotions must be shown on the invoice (rule inherited from Decree 123 Art. 10 cl. 6(đ)); free promotional items are invoiced at price 0 with a promotional note and a 0 VAT base only when the promotion complies with commercial law. *Inference:* redeeming points is a discount or free item, so every reward must map to a Fabi promotion that lands on the invoice; the loyalty ledger does not create a separate invoicing duty.

## 4. Marketing messages: Decree 91/2020, Consumer Protection Law 2023, Zalo rules

Decree 91/2020 (SMS, MMS, USSD, email, calls): prior consent, one registration message only, [QC]/[AD] label, 07:00–22:00 for SMS (08:00–17:00 calls), max 3 messages per number per day, opt-out instruction with one-time confirmation, registered brandname, Do-Not-Call list 5656. Fines 5–10 million VND (no consent), 20–30 million VND (hours, verification), 80–100 million VND (DNC numbers). OTT apps are not expressly covered; a Ministry of Public Security draft replacing the decree was under consultation in September 2026.

The Consumer Protection Law 19/2023/QH15 (1 July 2024) bans harassment against the consumer's will (Art. 10), requires published information-protection rules (Art. 16), notice and consent before collection (Art. 17), a choice about advertising use and third-party sharing (Art. 18), and deletion when retention ends (Art. 20).

Zalo's platform rules are stricter than the law for ZNS (no promotions, vouchers or birthday wishes; 06:00–22:00; 200–300 VND per message) and allow advertising only in broadcasts to followers (1 per day, 4 free per month, Tăng trưởng 2,500,000 VND/year or Toàn diện 6,000,000 VND/year from 1 June 2026). An OA may message a user only after the user interacted or allowed interaction. Mini Apps cannot be published without terms covering personal data use and may request the phone number only at the relevant step.

## Checklist for this project

1. Confirm each brand's legal form and record the PDPL Art. 38 position.
2. Publish a Vietnamese privacy notice and information-protection rules in the Mini App and OA (tenant-configurable).
3. Per-purpose consent (loyalty, marketing) with an evidence table; no pre-ticked boxes; opt-out honoured within one sync interval.
4. Data-subject request flows with 2-day/20-day deadlines; 72-hour breach runbook.
5. Keep analytics aggregate; no behavioural tracking or location.
6. Define loyalty programmes with name, period and reward budget; notify the Sở Công Thương 3 working days before launch if the budget reaches 100 million VND.
7. Encode 50% discount cap, 120 discount-days/year and voucher value cap checks.
8. Map every reward to a Fabi promotion so the cash-register e-invoice shows it; reconcile after sync.
9. Channel policies: Decree 91 defaults for SMS/email; Zalo windows and content rules for OA/ZNS; marketing content only to consenting followers.
10. Outbound message log kept 12 months; legal-watch items for the Decree 91 replacement and iPOS Decree 254 updates.

## Sources

- Ministry of Public Security, PDPL in force 1 Jan 2026: https://bocongan.gov.vn/chinh-sach-phap-luat/bai-viet/luat-bao-ve-du-lieu-ca-nhan-chinh-thuc-co-hieu-luc-thi-hanh-tu-ngay-01-01-2026-1767186124
- Law 91/2025/QH15 text (LuatVietnam EN): https://english.luatvietnam.vn/dan-su/law-on-personal-data-protection-law-no-91-2025-qh15-405135-d1.html
- Tilleke & Gibbins on the PDPL and Decree 356: https://www.tilleke.com/insights/vietnams-new-personal-data-protection-law-a-closer-look/
- Frasers on Decree 356/2025 (19 Jan 2026): https://www.frasersvn.com/vi/legal-updates-and-publications/the-next-chapter-in-data-protection-new-decree-guiding-the-personal-data-protection-law
- EY on Decree 356/2025 (3 Mar 2026): https://www.ey.com/vi_vn/technical/tax/tax-and-law-updates/nghi-dinh-so-356-2025-nd-cp-quy-dinh-chi-tiet-mot-so-dieu-va-bien-phap-thi-hanh-luat-bao-ve-du-lieu-ca-nhan
- LuatVietnam on Decree 356 (DPO, Art. 41 exemptions): https://luatvietnam.vn/doanh-nghiep/doanh-nghiep-can-biet-gi-ve-bao-ve-du-lieu-ca-nhan-tai-nghi-dinh-356-2025-nd-cp-561-109567-article.html
- Wiki Legal on Decree 356 (consent records, deletion deadlines): https://wikilegal.vn/nghi-dinh-356-2025-nd-cp-diem-moi-ve-bao-ve-du-lieu-ca-nhan/
- LuatVietnam on Decree 330/2026 (3 billion cap): https://luatvietnam.vn/tin-van-ban-moi/nghi-dinh-330-2026-vi-pham-ve-bao-ve-du-lieu-ca-nhan-co-the-bi-phat-den-3-ty-dong-186-111871-article.html
- LuatVietnam on Decree 330 Art. 43 consent fines: https://luatvietnam.vn/tin-van-ban-moi/nghi-dinh-330-2026-xu-ly-du-lieu-ca-nhan-khi-chua-duoc-dong-y-phat-den-50-trieu-dong-186-111771-article.html
- Decree 81/2018 text: https://dulieuphapluat.vn/van-ban/thuong-mai-van-ban/nghi-dinh-812018nd-cp-huong-dan-luat-thuong-mai-ve-hoat-dong-xuc-tien-thuong-mai-78245.html
- Decree 128/2024 text (VCCI): https://vcci.com.vn/legal-document/128-2024-nd-cp
- Viet An Law on Decree 128/2024: https://luatvietan.vn/nghi-dinh-128-2024-nd-cp-cap-nhat-quy-dinh-moi-ve-hoat-dong-khuyen-mai.html
- Gonnapass, notification vs registration table (3 Jun 2026): https://gonnapass.com/quy-dinh-ve-cac-truong-hop-phai-dang-ky-hoac-thong-bao-hoat-dong-khuyen-mai/
- iPOS on Decree 70/2025: https://ipos.vn/nghi-dinh-70-2025-nd-cp-nhung-thay-doi-lon-den-nganh-fnb__trashed/
- EY on Decree 254/2026 and Circular 91/2026: https://www.ey.com/vi_vn/technical/tax/tax-and-law-updates/nghi-dinh-254-2026-nd-cp-ve-hoa-don-dien-tu-va-chung-tu-dien-tu
- MISA AMIS on Decree 254/2026: https://amis.misa.vn/279369/nghi-dinh-254-2026/
- Decree 254 Art. 6 for F&B (Góc nhìn pháp lý, 1 Sep 2026): https://gocnhinphaply.nguoiduatin.vn/ho-kinh-doanh-su-dung-hoa-don-dien-tu-nao-khi-cung-cap-dich-vu-an-uong-nha-hang-theo-nghi-dinh-254-49875.html
- Decree 254 metadata and signed PDF (Government portal): https://vanban.chinhphu.vn/?pageid=27160&docid=218689
- Decree 123 Art. 10 cl. 6(đ) on discounts: https://vnc-os.com/vi/tham-khao-ve-viec-lap-hoa-don-chiet-khau-thuong-mai-theo-nghi-dinh-so-123-2020-nd-cp-va-thong-tu-so-78-2021-tt-btc/
- MoF answer on free promotional goods: https://chinhsachonline.chinhphu.vn/cach-viet-hoa-don-hang-khuyen-mai-khong-thu-tien-70834.htm
- Decree 141/2026 threshold (Tạp chí Công Thương): https://tapchicongthuong.vn/chinh-thuc--nang-nguong-chiu-thue-voi-ho-kinh-doanh-len-1-ty-dong-nam--ap-dung-tu-1-1-2026-514336.htm
- Decree 91/2020 chapters 1 and 3: https://hethongphapluat.com/nghi-dinh-91-2020-nd-cp-ve-chong-tin-nhan-rac-thu-dien-tu-rac-cuoc-goi-rac/chuong-1 and https://hethongphapluat.com/nghi-dinh-91-2020-nd-cp-ve-chong-tin-nhan-rac-thu-dien-tu-rac-cuoc-goi-rac/chuong-3
- Spam fines after Decree 14/2022 (LSVN, 9 Feb 2022): https://lsvn.vn/nhan-tin-quang-cao-sau-22h-bi-phat-toi-30-trieu-dong1644378618-a115071.html
- Draft replacement of Decree 91 (VnEconomy, 10 Sep 2026): https://vneconomy.vn/de-xuat-thay-nghi-dinh-91-siet-quan-ly-cuoc-goi-va-tin-nhan-rac.htm
- Law 19/2023/QH15 (LuatVietnam EN): https://english.luatvietnam.vn/thuong-mai/law-on-protection-of-consumer-rights-no-19-2023-qh15-259732-d1.html
- Decree 55/2024 overview (DMS): https://dms.gov.vn/tin-chi-tiet/-/chi-tiet/mot-so-%C4%91iem-moi-tai-nghi-%C4%91inh-so-55-2024-n%C4%91-cp-ngay-16-5-2024-cua-chinh-phu-80163-3.html
- Zalo OA message policy: https://oa.zalo.me/home/resources/news/thong-bao-chinh-sach-gui-tin-va-quy-dinh-phi-gui-tin_1433049880779375099
- Zalo OA broadcast FAQ (packages from 1 Jun 2026): https://oa.zalo.me/home/documents/guides/cau-hoi-thuong-gap-tin-broadcast
- Zalo OA pricing: https://zalo.solutions/oa/pricing
- ZNS pricing: https://zalo.solutions/zns/pricing
- ZNS sending rules (eSMS help centre): https://helpcenter.esms.vn/thong-tin-dich-vu/tra-cuu-thong-tin-ho-so/zalo/zalo-notification-service-zns/quy-dinh-gui-tin-nhan-zns
- Zalo Mini App permission policy (1 Mar 2024): https://miniapp.zaloplatforms.com/blog/huong-dan-xin-quyen-nguoi-dung-01-03-2024/
