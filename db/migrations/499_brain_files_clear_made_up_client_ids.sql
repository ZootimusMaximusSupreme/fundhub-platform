-- 499: Drive recordings stop pointing at clients that do not exist.
--
-- The Company Brain Drive sync reads any UUID in a file name as a client id. iPhone exports are
-- named <UUID>.mp4, so brain_files rows were saved with a client_id that is no client at all
-- (14 rows on 2026-10-20, red on the sales-floor "Recording rows" heartbeat). The code now keeps a
-- sniffed client id only when that client exists in the same company (src/company-brain/store.mjs).
--
-- This clears the rows that were already saved. It sets client_id to NULL ONLY where a client_id is
-- present and no clients row has that id in the same org. It deletes nothing, it touches no other
-- column (the table's own trigger stamps updated_at), and a second run matches no rows.
-- The Drive links and the files stay exactly as they are.

DO $$
BEGIN
  IF to_regclass('public.brain_files') IS NULL OR to_regclass('public.clients') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.brain_files bf
     SET client_id = NULL
   WHERE bf.client_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.clients c
        WHERE c.id = bf.client_id
          AND c.org_id = bf.org_id
     );
END $$;
