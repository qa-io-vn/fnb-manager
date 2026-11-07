# Zalo standards deep-dive: Mini App design, review and OA content rules

*Research as of 2026-11-07. Official pages were rebuilt on 2026-11-05; OA message rules are effective 2026-01-01 and OA packages 2026-06-01. Facts are marked (official) or (third party).*

## 1. Design system and layout conventions

Zalo Mini Apps are React web apps rendered inside Zalo. The official UI kit is **ZaUI (`zmp-ui`, v1.11.0)**, a trimmed version of Zalo's internal ZDS design system, with tokens in the `zaui-tokens` package (official). What it fixes:

- **Header**: two kinds, the native bar configured in `app-config.json` and the `Header` component, which new apps use by default. Title and icon colour can only be white or black; the bar colour is free but must keep contrast. Show a back button only on secondary pages, avoid a "home" button, and never stack a second navigation bar under the default header. The **Mini App Control** (menu/close) is pinned top-right on every screen and nothing may be placed under it.
- **Bottom navigation**: ZaUI allows 4–6 items, but the review checklist caps it at **4 tabs**; always open the first tab; same behaviour on iOS and Android.
- **Page and Sheet**: `Page` handles scroll restore for tabs (`restoreScroll`) and detail pages (`restoreScrollOnBack`); `Sheet` provides swipe-to-close, snap points and a drag handle for secondary actions.
- **Safe areas and theming**: `app-config.json` sets `title` (required), `headerTitle` per language (vi/en), `headerColor`/`textColor` with `{light, dark}` values, `statusBar` normal/hidden/transparent, `hideIOSSafeAreaBottom` and `hideAndroidBottomNavigationBar` (API 2.25.0). zmp-ui exposes `--zaui-safe-area-inset-top`.
- **Typography and colour**: system fonts only (SF Pro on iOS, Roboto on Android); title scale 22/18/15 px, body 18→10 px; Zalo blue is `blue-55 #0068FF`. The guideline palette uses NL300 for primary text, NL700 for secondary, BL300 links, GL300 success, OL300 warning, RL300 error.
- **Logo**: the avatar is masked with a corner radius of 20 % of its width.

The **Design Guidelines** page adds behavioural rules: one highlighted focus per screen, visible loading state (progress bar under the action bar, modal only when unavoidable), result modal auto-dismissed after 1.5 s, popup when a decision is needed, a result page at the end of a flow, explicit offline/error feedback, minimised typing (location "Tìm gần nhất", pickers instead of keyboards) and touch targets of 7–9 mm. The default splash (logo + brand name) cannot be hidden.

## 2. Performance, accessibility and size

The review policy sets hard numbers: **LCP < 2.5 s, page load < 1.5 s, anything over 10 s is rejected** (§5.3), and the review overview adds **loading feedback after 300 ms** and **tap targets ≥ 44×44 pt** (official). The community-reported build limit is **10 MB per version and 3 MB per file**, enforced by `zmp deploy` error -2004 (third party, consistent across threads). Zalo publishes no accessibility standard beyond tap size and contrast; this project should adopt WCAG 2.1 AA contrast, 15 px body text and axe checks as its own standard.

## 3. Review checklist and rejection reasons

The **Chính sách kiểm duyệt Mini App** is explicit and example-based (official):

1. **Logo**: own brand mark, relevant, no QR code or phone number, no transparent background.
2. **Name**: no all caps, no generic nouns, no "App", "Mini App" or "Zalo", no emoji or special characters; an owner-identifying prefix/suffix is required.
3. **Description**: accurate, no links.
4. **Content**: no outbound links except embedded Privacy/Terms popups; no native-app or Google/Facebook login prompts; no ads; no virtual items, crypto or digital-content sales; no withdrawal/payout; no social-network features; policies must name the business and the Mini App.
5. **Performance**: every feature works, no demo placeholders, no white screens.
6. **Permissions** (name/avatar, phone, location, camera, notifications, follow OA): never on launch, purpose explained first, a working "từ chối" path, no fake system dialogs, no gating; login may be required only for internal apps (company, school, organisation).
7. **Privacy**: explicit consent, no third-party sharing, HTTPS with valid SSL, Decree 13/2023/NĐ-CP. (Zalo's policy text still cites Decree 13/2023; the Personal Data Protection Law 91/2025 replaced it on 1 January 2026 — see `vietnam-legal-requirements.md`.)
8. **Checkout SDK** is mandatory if prices are shown and orders taken; otherwise hide prices and use "Liên hệ"/"Tư vấn".
9. **Operation**: review in 3 working days; verified via OA or documents; **≥ 10 visits/month**; campaign apps must show start and end dates.

Agencies report the same rejection causes in practice: unfinished features, cash-like points or wallets, missing privacy policy, redirects to Facebook/TikTok, mismatch with the registered description, invalid names, missing ownership documents (third party, 2025–2026).

## 4. Listing requirements

The create-Mini-App API fixes **name 3–50 characters**, **description 20–500 characters**, a **category** enum including `FNB`, a required logo URL, optional cover and a `browsable` flag for the Mini App Store (official). Pixel sizes for icon and screenshots are not published; agencies use 256×256 px PNG logos and 720×312 px banners (third party). Highlands Rewards is listed under FNB with a one-sentence voucher description, and deep links take the form `zalo.me/s/<appId>`.

## 5. Phone-number permission

`getPhoneNumber` opens Zalo's consent popup and returns a **single-use token valid for 2 minutes**; the server exchanges it at `graph.zalo.me/v2.0/me/info` with the app secret (official). The doc cites policy 3.3.4: ask only when the feature needs it (ordering, joining) or show an onboarding screen if the number is essential, and warns that unclear flows are rejected. The permission itself must be requested in Mini App Center with a written reason and screenshots and is reviewed with a version; admins, developers and test users bypass the check, so testing never proves approval (community).

## 6. Zalo brand usage

No public Zalo logo guideline exists. VNG's brand site gives Zalo blue `#0068FF`; OA rules forbid imagery that imitates Zalo/VNG features; Mini App names may not contain "Zalo"; agencies say ZNS bodies may not contain the word either. Practical rule: use Zalo's colour only on "Quan tâm OA"/"Mở trong Zalo" CTAs and never redraw Zalo UI.

## 7. Official Account content rules

Effective 2026-01-01, OA messages are **Tư vấn** (after a user interaction; free within 48 h, 55 ₫ beyond; 365-day window in OA Manager, 7 days via API), **Broadcast** (followers only, OA Manager Web, **06:00–19:59**, ≥ 30 min apart, up to 5 contents, quota 4 per follower per month on Tăng trưởng/Toàn diện) and **ZBS Template** messages (Tag 1 transaction, Tag 2 care, Tag 3 after-sales/promotion). The interaction policy caps marketing messages at **1/day and 30/month per follower**, counts violations over 12 weeks and can lock the OA; 180 days of inactivity is also a lock reason (official). Template rules: Vietnamese with diacritics, one language, no links or phone numbers in the body (CTA buttons only), logo in light and dark versions, personalisation parameters, one message per transaction, promotions and follow invitations only as Tag 3.

## 8. Vietnamese F&B conventions and reference apps

VietQR transfer is the default non-cash habit: NAPAS counts ~15 M VietQR transfers a day and +52 % volume / +85 % value YoY in 10M2025; card fees of 3–4 % keep merchants on transfer QR. iPOS reports show 52 % of drinkers prefer drinks under 35,000 ₫ (2024) and frequent out-of-home drinking rising to 32.8 %. Reference Mini Apps:

| Brand | Shipped features |
|---|---|
| Highlands Rewards | voucher wallet, DRIPS points redemption, campaign games; 2 M users, 56.9 % conversion, +347 k OA follows in 40 days |
| Hồng Trà Ngô Gia (600+ shops, PosApp POS) | QR ordering, pick-up with time slot, digitised "Mua 8 tặng 1" points, OA care, e-vouchers, mini games; −60 % wait, +65 % members, 65 % return |
| Ming Coffee & More | branch ordering, delivery, multi-payment, points, promo codes, lucky wheel |
| Ampersand Rewards (The Running Bean, Häagen-Dazs…) | QR at table → follow OA → phone-based points, Gold/Diamond tiers, welcome voucher, birthday/tier ZNS; +80 % followers |
| KFC Vietnam | ordering, promotions, in-app payment |
| Golden Gate Rewards | ordering, table booking, multi-brand vouchers |

## 9. Design-and-review checklist for FNB Manager

- [ ] Names, logos, descriptions per tenant pass §1–3; no "Zalo"; FNB category.
- [ ] Both OAs verified and linked; business papers on file.
- [ ] Customer app browsable without permissions; phone asked only on "Tham gia thành viên"; "từ chối" path works; permission requests filed at first review.
- [ ] Staff app declared internal; onboarding explains login; pilot users registered as testers.
- [ ] Privacy/Terms embedded as popups per tenant; consent logged.
- [ ] Points redeem only to coupons/products; rate and expiry in Terms.
- [ ] No prices with buy buttons until Checkout SDK is integrated.
- [ ] CI budgets: bundle ≤ 10 MB, file ≤ 3 MB, LCP < 2.5 s, load < 1.5 s.
- [ ] ≤ 4 tabs, 44×44 pt targets, loading after 300 ms, nothing under the Zalo menu, light/dark header colours.
- [ ] Messaging matrix: transactional → ZBS Tag 1/2, promotions → Tag 3 or broadcast within 4/follower/month and 06:00–19:59; staff digests via GMF group or daily CTA.
- [ ] Operations: ≥ 10 visits/month, OA active within 180 days.

## Sources

- Mini App review policy: https://mini.zalo.me/documents/zalo-mini-app-censorship-policy/
- Review overview (KYB, technical, UI criteria): https://docs.zaloplatforms.com/docs/MA/intro/censorship-overview
- Design Guidelines: https://mini.zalo.me/documents/intro/zalo-mini-app-design-guidelines/
- Permission request guide: https://docs.zaloplatforms.com/docs/MA/intro/request-permission
- Publishing flow: https://docs.zaloplatforms.com/docs/MA/intro/public-mini-program
- getPhoneNumber: https://mini.zalo.me/documents/api/getPhoneNumber/
- app-config.json: https://mini.zalo.me/documents/devtools/app-config
- ZaUI overview, Header, BottomNavigation, Sheet, Typography, Colors, Mini App Logo: https://miniapp.zaloplatforms.com/documents/zaui/ , https://docs.zaloplatforms.com/docs/MA/zaui/layout/Header , https://docs.zaloplatforms.com/docs/MA/zaui/layout/BottomNavigation , https://docs.zaloplatforms.com/docs/MA/zaui/overlay/Sheet , https://docs.zaloplatforms.com/docs/MA/zaui/foundation/Typography , https://docs.zaloplatforms.com/docs/MA/zaui/foundation/Colors , https://docs.zaloplatforms.com/docs/MA/zaui/foundation/MiniAppLogo
- Create Mini App API (name/description/category limits): https://docs.zaloplatforms.com/docs/MA/openApis/partner/apis/createMiniApp
- Checkout SDK: https://miniapp.zaloplatforms.com/documents/payment/
- followOA best practice: https://docs.zaloplatforms.com/docs/MA/intro/best-practices/widget-follow-oa
- Build size and deploy quota threads (community): https://miniapp.zaloplatforms.com/community/5218344787686543047/dung-luong-mini-app , https://miniapp.zaloplatforms.com/community/2803533029779252036/gioi-han-ban-testing-va-development
- Rejection reasons (third party): https://pandaloyalty.com/loi-pho-bien-khien-zalo-mini-app-bi-tu-choi/ , https://miniapp.vn/quy-trinh-kiem-duyet-zalo-mini-app/ , https://miniapp.vn/cap-nhat-va-release-zalo-mini-app/
- OA policies: https://oa.zalo.me/home/documents/policy/dang-ky-va-su-dung-tai-khoan-zalo-official-account-doanh-nghiep , https://oa.zalo.me/home/documents/guides/anh-dai-dien-anh-bia-oa_72 , https://oa.zalo.me/home/documents/policy/tuong-tac-cua-oa-voi-nguoi-dung , https://oa.zalo.me/home/documents/policy/khoa-tai-khoan
- OA message types and broadcast guide: https://oa.zalo.me/home/documents/guides/tong-quan-cac-loai-tin-nhan-tren-zalo-official-account-_3651713298729094511 , https://oa.zalo.me/home/documents/guides/huong-dan-gui-tin-broadcast_71
- OA packages and prices: https://zalo.solutions/oa/pricing , https://oa.zalo.me/home/resources/news/162026-zalo-official-account-trien-khai-4-goi-dich-vu-moi-toi-uu-hieu-suat-theo-nhu-cau-doanh-nghiep-_109742821673880689
- ZBS/ZNS template rules: https://zalo.solutions/news/quy-dinh-chung-khi-kiem-duyet-mau-tin-zns/xdygqtrjjm97k28rsh07wr72 , https://www.infobip.com/docs/zalo/compliance-guidelines
- VNG brand colours: https://www.vng.com.vn/guidelines/brand/colour-palettes.html
- Zalo MAU: https://cms-investor-cdn.vng.com.vn/VNG_Snapshot_H1_2026_EN_9251ea99bc.pdf
- Payments: https://en.vietnamplus.vn/vietnamese-street-vendors-go-cashless-as-qr-payments-surge-85-post334216.vnp , https://en.vneconomy.vn/opportunities-for-qr-payment-growth.htm , https://static1.vietstock.vn/edocs/13715/BAO_CAO_NGANH_FB_1_.pdf
- iPOS F&B reports: https://ipos.vn/thong-cao-bao-chi-ipos-vn-va-nestle-professional-cong-bo-bao-cao-thi-truong-kinh-doanh-am-thuc-tai-viet-nam-nam-2024/ , https://ipos.vn/thong-cao-bao-chi-ipos-vn-va-nestle-professional-cong-bo-bao-cao-thi-truong-kinh-doanh-am-thuc-tai-viet-nam-nam-2025/
- F&B Mini Apps: https://miniforbusiness.zalo.me/solutions/fnb , https://miniforbusiness.zalo.me/case-study/highlands-coffee-tang-ti-le-chuyen-doi-voi-chien-dich-phat-voucher-tren-zalo-mini-app , https://miniapp.zaloplatforms.com/apps/327411629127312067/ , https://miniforbusiness.zalo.me/case-study/tu-hang-cho-den-65-khach-quay-lai-cach-hong-tra-ngo-gia-bien-moi-don-hang-thanh-ly-do-cho-lan-mua-tiep-theo-2 , https://miniforbusiness.zalo.me/case-study/zalo-mini-app-vu-khi-bi-mat-x3-doanh-so-cua-nha-ming-coffee , https://miniforbusiness.zalo.me/case-study/ampersand-management-trien-khai-zalo-mini-app-tich-hop-gui-tin-zalo-uid-zns-tu-dong , https://oazbs.vn/app-store/
