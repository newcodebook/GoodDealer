-- An outbox row's `created_at` is a canonical UTC instant, `YYYY-MM-DDTHH:MM:SSZ`.
-- History counts today's changes by comparing it as text with the person's day bounds, which only
-- orders correctly in that one form; `strftime` returns exactly those values unchanged and turns an
-- impossible date, a fraction or an offset into something else. It also keeps `24:00:00`, which
-- the Host's `validate_timestamp` refuses, so the hour is bounded separately. Rows written before
-- this migration are not rewritten; the History read fails closed on any it finds.
CREATE TRIGGER sync_outbox_created_at_insert_is_canonical
BEFORE INSERT ON sync_outbox
WHEN NEW.created_at IS NOT strftime('%Y-%m-%dT%H:%M:%SZ', NEW.created_at)
  OR substr(NEW.created_at, 12, 2) > '23'
BEGIN
  SELECT RAISE(ABORT, 'created_at must be a canonical UTC instant');
END;

CREATE TRIGGER sync_outbox_created_at_update_is_canonical
BEFORE UPDATE OF created_at ON sync_outbox
WHEN NEW.created_at IS NOT strftime('%Y-%m-%dT%H:%M:%SZ', NEW.created_at)
  OR substr(NEW.created_at, 12, 2) > '23'
BEGIN
  SELECT RAISE(ABORT, 'created_at must be a canonical UTC instant');
END;
