alter type public.consent_purpose add value if not exists 'notifications';

comment on type public.consent_purpose is 'what a consent record allows: loyalty for the membership programme, marketing for advertising messages, staff_ops for shift operations in the staff app, notifications for the daily digests and operational alerts a member receives on their own destinations; a notifications row is recorded only at the member''s own acceptance of the notice ops-notifications-v1 and never from the browser';
