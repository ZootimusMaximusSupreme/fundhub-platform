-- Chris is the human setter and closer for launch. Keep his booked-call alert on.
-- A later setter hire manages the same switch in Staff & Teams.
UPDATE staff
   SET phone = '+16616180865',
       notify_booked_call_sms = true
 WHERE lower(email) = 'chris@fundhub.ai'
   AND role = 'owner'
   AND status = 'active'
   AND COALESCE(is_demo, false) = false;
