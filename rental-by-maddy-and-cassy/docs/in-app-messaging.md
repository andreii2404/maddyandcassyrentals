# In-app messaging architecture

## Guest and registered-user logic

The application uses the same trusted Supabase Auth identity for both kinds of customer:

- **Registered customer:** their normal Supabase user ID owns the conversation. The full history loads whenever that account signs in.
- **Guest customer:** `signInAnonymously()` creates a temporary Supabase Auth user and session. This is not a permanent customer account, but it gives the guest a secure ID and an `authenticated` JWT so row-level security and Realtime work exactly as they do for a registered customer.
- **Booking-linked guest chat:** when a conversation has a `booking_id`, authorization also follows `bookings.customer_id`. If the existing guest-booking recovery flow transfers that booking to a fresh anonymous session, opening the linked conversation transfers its owner to the recovered guest ID.
- **General guest chat:** it remains available while the browser keeps its anonymous session. The interface explains this limitation and offers account creation for future conversations across devices; it does not misleadingly claim that an existing anonymous thread is automatically converted.

Raw device fingerprints and unprotected IDs are intentionally not used. A device ID can be copied and does not provide authentication. Short-lived custom tokens would duplicate the auth/session system the project already has.

## Database schema

### `chat_conversations`

One row represents a customer-support thread. It stores the customer Auth ID, an optional booking, subject/status, latest-message preview, and separate customer/admin read timestamps.

### `chat_messages`

One row represents one message. It stores the conversation, sender Auth ID, sender role (`customer`, `admin`, or `system`), message type, body, timestamp, and a client-generated idempotency ID. The unique conversation/client-ID pair prevents accidental duplicate sends.

Both tables have RLS enabled. Customers and anonymous guests can read only their own threads. Active admins can read all threads. Direct browser writes are revoked; validated security-definer RPCs perform mutations.

## Message routing

1. The customer page creates or finds the caller's support conversation through `get_or_create_chat_conversation`.
2. The browser loads its inbox through `list_chat_conversations` and the selected history through `list_chat_messages`.
3. Sending calls `send_chat_message`. The database validates authentication, access, thread status, length, and the idempotency key in one transaction.
4. The function inserts the message and atomically updates the conversation preview/read timestamp.
5. Supabase Postgres Changes publishes the permitted row. RLS decides which connected clients receive it.
6. Customer and admin clients refresh the affected conversation/history immediately. A reconnect still loads the persistent database record, so Realtime is an accelerator rather than the source of truth.

## Frontend layout

- Desktop/tablet: two-panel inbox, with conversations and unread badges on the left and the active chat on the right.
- Mobile: the inbox and active chat become separate views with a clear Back control.
- Messages use role-specific bubbles, compact timestamps, a system-message treatment, and a composer fixed to the bottom of the chat panel.
- Admins use `/admin/messages`; customers and guests use `/messages`.

## Security and operations

- Message bodies are trimmed and limited to 2,000 characters in both UI and database logic.
- RPC execution is granted only to authenticated sessions (including Supabase anonymous users) and the service role.
- New public tables have explicit grants because current Supabase Data API defaults no longer expose new tables automatically.
- Realtime is enabled only for the two messaging tables; the protected `realtime` schema is not modified.
- For higher-volume future use, Postgres Changes can be replaced by private-channel Broadcast without changing the persistent schema or UI service contract.
