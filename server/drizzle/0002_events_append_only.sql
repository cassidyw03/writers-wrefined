-- Events are immutable (FR6). The database itself refuses any UPDATE to the events table.
-- DELETE stays allowed so deleting a book (FR14) can cascade to its events.
CREATE FUNCTION events_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events are append-only and cannot be updated';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER events_append_only
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION events_block_update();
