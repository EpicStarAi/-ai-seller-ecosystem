-- 009_donor_access_status_membership_unverified.sql
--
-- The Donor Manager API writes access_status = 'membership_unverified' when
-- Telegram getChat succeeds but getChatMember returns "member list is
-- inaccessible". The previous check constraint only allowed
-- not_checked, bot_member, bot_not_member, and inaccessible, so the
-- verified channel could not be saved.

ALTER TABLE public.autoposting_donors
  DROP CONSTRAINT IF EXISTS autoposting_donors_access_status_check;

ALTER TABLE public.autoposting_donors
  ADD CONSTRAINT autoposting_donors_access_status_check
  CHECK (access_status = ANY (ARRAY[
    'not_checked'::text,
    'bot_member'::text,
    'bot_not_member'::text,
    'inaccessible'::text,
    'membership_unverified'::text
  ]));
