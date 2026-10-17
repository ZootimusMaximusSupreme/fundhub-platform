# Client portal — confirm an upcoming call (draft for owner review)

Role: signed-in client. Job: confirm that they can attend their next booked call.

1. A booking provider creates or moves a call. The server keeps the call in `bookings` and clears the client's prior `call_confirmed` flag, because that answer belonged to an earlier time.
2. On portal load, `/api/read/portal-summary` reads only this session's client and company. It returns the earliest future booking whose status is `booked` or `rescheduled`, plus whether `call_confirmed` is true.
3. While that read runs, the call card shows a skeleton. With no upcoming call, the card goes away. If the read fails, the card says it could not check and asks the client to reload.
4. If the call is already confirmed, the card shows its time and confirmed status, without a button. Otherwise it shows its time and **Confirm my call**.
5. Pressing the button sends the booking ID to `POST /api/bookings`. The session, not a posted client ID, determines which file can be changed. The server accepts only that client's earliest future booked/rescheduled call; a changed or cancelled call is refused.
6. After a successful write, the button disappears and the card says the call is confirmed. A repeat request has the same result. A failed write leaves the button available with a retry message.

No booking is created, moved, cancelled, or marked held by this action. Staff calendar reads remain staff-only.
