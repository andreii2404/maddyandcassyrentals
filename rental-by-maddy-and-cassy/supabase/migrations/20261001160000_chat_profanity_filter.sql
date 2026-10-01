-- Customer chat messages containing profane or offensive language (English and
-- Tagalog/Filipino) are rejected inside send_chat_message, so the rule holds
-- for guests and signed-in customers alike and cannot be bypassed by calling
-- the RPC directly. Rejected messages are never stored. Admin replies are not
-- screened, and existing messages are left untouched.
--
-- This mirrors src/lib/chatProfanity.ts, which gives the composer instant
-- feedback. The term list and character maps must stay identical in both
-- places; scripts/testMessaging.ts checks that they do.

-- kind 'contains': matched anywhere inside a word.
-- kind 'word': matched as a whole word, optionally followed by one suffix.
-- kind 'phrase': space-separated parts matched against consecutive words.
create or replace function private.chat_profanity_terms()
returns table (match_kind text, term text, suffixes text[])
language sql
immutable
set search_path = ''
as $$
  select terms.match_kind, terms.term, terms.suffixes
  from (values
    ('contains', 'fuck', array['', 's', 'ed', 'er', 'ers', 'ing', 'in', 'face', 'head', 'off', 'wit']),
    ('contains', 'fck', array['', 's', 'ed', 'er', 'ing']),
    ('contains', 'phuck', array['', 's', 'ed', 'er', 'ing']),
    ('contains', 'cocksucker', array['', 's']),
    ('contains', 'putangina', array['', 'mo', 'ng']),
    ('contains', 'tangina', array['', 'mo', 'ng']),
    ('contains', 'pukingina', array['', 'mo']),
    ('contains', 'kantot', array['', 'an', 'in']),
    ('contains', 'kantut', array['', 'an']),
    ('contains', 'pakyu', array['', 'ka']),
    ('contains', 'pakshet', array['']),
    ('word', 'fuk', array['', 's', 'ed', 'er', 'ing', 'in']),
    ('word', 'fuq', array['', 'ing']),
    ('word', 'shit', array['', 's', 'ty', 'ting', 'ted', 'head', 'heads', 'face', 'hole', 'load', 'show', 'bag']),
    ('word', 'bullshit', array['', 's', 'ting']),
    ('word', 'horseshit', array['']),
    ('word', 'dipshit', array['', 's']),
    ('word', 'batshit', array['']),
    ('word', 'bitch', array['', 'es', 'y', 'ing', 'ass']),
    ('word', 'biatch', array['', 'es']),
    ('word', 'asshole', array['', 's']),
    ('word', 'arsehole', array['', 's']),
    ('word', 'dumbass', array['', 'es']),
    ('word', 'jackass', array['', 'es']),
    ('word', 'bastard', array['', 's']),
    ('word', 'cunt', array['', 's', 'y']),
    ('word', 'dickhead', array['', 's']),
    ('word', 'whore', array['', 's']),
    ('word', 'slut', array['', 's', 'ty']),
    ('word', 'twat', array['', 's']),
    ('word', 'wanker', array['', 's']),
    ('word', 'douchebag', array['', 's']),
    ('word', 'nigger', array['', 's']),
    ('word', 'nigga', array['', 's', 'z']),
    ('word', 'faggot', array['', 's']),
    ('word', 'retard', array['', 's', 'ed']),
    ('word', 'puta', array['', 'ng']),
    ('word', 'pota', array['', 'ng']),
    ('word', 'taena', array['', 'mo']),
    ('word', 'tngina', array['', 'mo']),
    ('word', 'tangna', array['', 'mo']),
    ('word', 'kingina', array['', 'mo']),
    ('word', 'gago', array['', 'ng']),
    ('word', 'ulol', array['', 'ng']),
    ('word', 'ulul', array['']),
    ('word', 'tarantado', array['', 'ng']),
    ('word', 'tarantada', array['']),
    ('word', 'punyeta', array['', 'ng']),
    ('word', 'bobo', array['', 'ng']),
    ('word', 'tanga', array['', 'ng']),
    ('word', 'shunga', array['', 'ng']),
    ('word', 'gunggong', array['']),
    ('word', 'kupal', array['', 'ng']),
    ('word', 'pokpok', array['', 'ng']),
    ('word', 'hindot', array['', 'ng']),
    ('word', 'jakol', array['', 'in']),
    ('word', 'salsal', array['']),
    ('word', 'bilat', array['']),
    ('word', 'burat', array['']),
    ('word', 'tite', array['', 'ng']),
    ('word', 'pekpek', array['']),
    ('word', 'iyot', array['', 'an', 'in']),
    ('phrase', 'tang ina', array['']),
    ('phrase', 'puking ina', array['']),
    ('phrase', 'puchang ina', array['']),
    ('phrase', 'hayop ka', array['']),
    ('phrase', 'hayup ka', array['']),
    ('phrase', 'pak yu', array['']),
    ('phrase', 'pak shet', array[''])
  ) as terms(match_kind, term, suffixes);
$$;

-- Lets every letter repeat so stretched spellings still match: gago -> g+a+g+o+.
create or replace function private.chat_profanity_term_pattern(p_term text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(p_term, '([a-z])', '\1+', 'g');
$$;

create or replace function private.chat_message_has_profanity(p_body text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text;
  v_raw_word text;
  v_word text;
  v_joined text;
  v_piece text;
  v_letter_run text := '';
  v_candidates text[] := array[]::text[];
  v_tokens text[] := array[]::text[];
  v_candidate text;
  v_letters text;
  v_contains_pattern text;
  v_word_pattern text;
  v_masked_pattern text;
  v_parts text[];
  v_start integer;
  v_offset integer;
  v_phrase_matched boolean;
begin
  select string_agg(private.chat_profanity_term_pattern(entry.term), '|')
  into v_contains_pattern
  from private.chat_profanity_terms() as entry
  where entry.match_kind = 'contains';

  select '^(?:' || string_agg(
      private.chat_profanity_term_pattern(entry.term)
        || '(?:' || array_to_string(entry.suffixes, '|') || ')',
      '|'
    ) || ')$'
  into v_word_pattern
  from private.chat_profanity_terms() as entry
  where entry.match_kind = 'word';

  -- Fold case, accents, zero-width characters and look-alike Cyrillic letters.
  v_text := lower(normalize(coalesce(p_body, ''), NFKD));
  v_text := regexp_replace(v_text, '[̀-ͯ]', '', 'g');
  v_text := regexp_replace(v_text, '[​-‍﻿­]', '', 'g');
  v_text := translate(v_text, 'аеорсухікАЕОРСУХІК', 'aeopcyxikaeopcyxik');

  foreach v_raw_word in array regexp_split_to_array(v_text, '\s+') loop
    v_word := regexp_replace(v_raw_word, '^[^a-z0-9@$]+', '');
    v_word := regexp_replace(v_word, '[^a-z0-9*#$]+$', '');
    -- Undo symbol and number substitutions such as f@ck, sh!t and b1tch.
    v_word := translate(v_word, '0134578@$!|+', 'oieastbasiit');
    v_joined := regexp_replace(v_word, '[^a-z*#]', '', 'g');
    continue when v_joined = '';

    v_tokens := v_tokens || v_joined;
    v_candidates := v_candidates || v_joined;
    foreach v_piece in array regexp_split_to_array(v_word, '[^a-z*#]+') loop
      if v_piece <> '' then
        v_candidates := v_candidates || v_piece;
      end if;
    end loop;

    -- Three or more single letters in a row are read as one word: f u c k.
    if length(v_joined) = 1 then
      v_letter_run := v_letter_run || v_joined;
    else
      if length(v_letter_run) >= 3 then
        v_candidates := v_candidates || v_letter_run;
      end if;
      v_letter_run := '';
    end if;
  end loop;
  if length(v_letter_run) >= 3 then
    v_candidates := v_candidates || v_letter_run;
  end if;

  foreach v_candidate in array v_candidates loop
    if v_candidate !~ '[*#]' then
      if v_candidate ~ v_contains_pattern or v_candidate ~ v_word_pattern then
        return true;
      end if;
    else
      -- `*` and `#` stand for one hidden letter each: f**k.
      v_letters := regexp_replace(v_candidate, '[*#]', '', 'g');
      if v_letters <> ''
        and (v_letters ~ v_contains_pattern or v_letters ~ v_word_pattern)
      then
        return true;
      end if;
      if length(v_letters) >= 2
        and length(v_candidate) - length(v_letters) <= length(v_letters)
      then
        v_masked_pattern := '^' || regexp_replace(
          private.chat_profanity_term_pattern(v_candidate),
          '[*#]',
          '[a-z]',
          'g'
        ) || '$';
        if exists (
          select 1
          from private.chat_profanity_terms() as entry
          cross join lateral unnest(entry.suffixes) as ending(suffix)
          where entry.match_kind <> 'phrase'
            and (entry.term || ending.suffix) ~ v_masked_pattern
        ) then
          return true;
        end if;
      end if;
    end if;
  end loop;

  for v_parts in
    select string_to_array(entry.term, ' ')
    from private.chat_profanity_terms() as entry
    where entry.match_kind = 'phrase'
  loop
    for v_start in 1 .. coalesce(array_length(v_tokens, 1), 0) - array_length(v_parts, 1) + 1 loop
      v_phrase_matched := true;
      for v_offset in 1 .. array_length(v_parts, 1) loop
        if v_tokens[v_start + v_offset - 1]
          !~ ('^' || private.chat_profanity_term_pattern(v_parts[v_offset]) || '$')
        then
          v_phrase_matched := false;
          exit;
        end if;
      end loop;
      if v_phrase_matched then
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$$;

revoke all on function private.chat_profanity_terms() from public, anon, authenticated;
revoke all on function private.chat_profanity_term_pattern(text) from public, anon, authenticated;
revoke all on function private.chat_message_has_profanity(text) from public, anon, authenticated;

-- Same body as 20261001120000_limit_consecutive_customer_messages.sql, plus the
-- customer profanity check before the message is stored.
create or replace function public.send_chat_message(
  p_conversation_id uuid,
  p_body text,
  p_client_message_id uuid
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  sender_role text,
  sender_name text,
  message_type text,
  body text,
  created_at timestamptz,
  edited_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_role text;
  v_body text := trim(coalesce(p_body, ''));
  v_message public.chat_messages;
  v_conversation public.chat_conversations;
  v_sender_name text;
  v_existing_message_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '28000';
  end if;
  if length(v_body) < 1 or length(v_body) > 2000 then
    raise exception 'INVALID_MESSAGE';
  end if;
  if p_client_message_id is null then
    raise exception 'MESSAGE_ID_REQUIRED';
  end if;

  if (
    select count(*)
    from public.chat_messages as recent_message
    where recent_message.sender_id = v_uid
      and recent_message.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'CHAT_RATE_LIMIT';
  end if;

  select conversation.*
  into v_conversation
  from public.chat_conversations as conversation
  where conversation.id = p_conversation_id
  for update;

  if v_conversation.id is null
    or not private.can_access_chat_conversation(p_conversation_id, v_uid)
  then
    raise exception 'CHAT_ACCESS_DENIED' using errcode = '42501';
  end if;
  if v_conversation.status <> 'open' then
    raise exception 'CHAT_CLOSED';
  end if;

  v_is_admin := (select private.is_admin());
  v_role := case when v_is_admin then 'admin' else 'customer' end;

  -- Guests and signed-in customers share this check; nothing is stored when
  -- it fails. Admin replies are not screened.
  if not v_is_admin and private.chat_message_has_profanity(v_body) then
    raise exception 'CHAT_INAPPROPRIATE_LANGUAGE';
  end if;

  -- A retry reuses the same client_message_id, so an already stored message must
  -- never be rejected by the consecutive-message allowance.
  select stored_message.id
  into v_existing_message_id
  from public.chat_messages as stored_message
  where stored_message.conversation_id = p_conversation_id
    and stored_message.client_message_id = p_client_message_id;

  -- The row lock taken above serialises concurrent sends on the same
  -- conversation, so this count cannot be raced past the limit.
  if not v_is_admin
    and v_existing_message_id is null
    and private.count_pending_customer_messages(p_conversation_id)
      >= private.chat_customer_message_limit()
  then
    raise exception 'CHAT_REPLY_REQUIRED';
  end if;

  insert into public.chat_messages as inserted_message (
    conversation_id,
    sender_id,
    sender_role,
    message_type,
    body,
    client_message_id
  ) values (
    p_conversation_id,
    v_uid,
    v_role,
    'text',
    v_body,
    p_client_message_id
  )
  on conflict on constraint chat_messages_client_key do update
    set client_message_id = excluded.client_message_id
  returning inserted_message.* into v_message;

  update public.chat_conversations
  set
    last_message_preview = left(v_body, 180),
    last_message_at = v_message.created_at,
    updated_at = now(),
    customer_last_read_at = case when v_is_admin then customer_last_read_at else now() end,
    admin_last_read_at = case when v_is_admin then now() else admin_last_read_at end
  where chat_conversations.id = p_conversation_id;

  select case
    when v_is_admin then 'Maddy & Cassy Support'
    else coalesce(nullif(trim(profile.display_name), ''), 'Guest customer')
  end
  into v_sender_name
  from (values (1)) as singleton(value)
  left join public.profiles as profile on profile.id = v_uid;

  return query
  select
    v_message.id,
    v_message.conversation_id,
    v_message.sender_id,
    v_message.sender_role,
    v_sender_name,
    v_message.message_type,
    v_message.body,
    v_message.created_at,
    v_message.edited_at;
end;
$$;

revoke all on function public.send_chat_message(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.send_chat_message(uuid, text, uuid)
  to authenticated;
grant execute on function public.send_chat_message(uuid, text, uuid)
  to service_role;

comment on function private.chat_message_has_profanity(text) is
  'True when a chat message contains blocked English or Tagalog/Filipino language. Mirrors src/lib/chatProfanity.ts.';
