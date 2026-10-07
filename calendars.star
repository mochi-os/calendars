# Mochi Calendars app
# Copyright © 2026 Mochisoft OÜ
# SPDX-License-Identifier: AGPL-3.0-only
# This file is part of Mochi, licensed under the GNU AGPL v3 with the
# Mochi Application Interface Exception - see license.txt and license-exception.md.

# A calendar is an entity of class calendar with a row here; an event is one
# iCalendar object, stored as text with the columns the views list and filter
# by. The app never parses iCalendar itself: core's mochi.ical functions parse,
# summarise and expand, and core's DAV engine serves the caldav/*path route
# over the dav/* functions at the end of this file.
#
# Four kinds of calendar: own (the user's events), subscription (an external
# ICS URL, polled, read-only), birthdays (derived from contacts, read-only,
# nothing stored) and linked (a calendar on another CalDAV server, reached
# through a connected account, synced both ways: pulled on a schedule and
# pushed on every write, with the server's version winning a conflict).

_PRODID = "-//Mochisoft//Mochi Calendars//EN"

# Bounds. An event's text; the bytes one subscription fetch may carry, which
# is as much as mochi.ical.parse reads; components in one object. There is no
# bound on how many events a person or a calendar holds: refusing a person's
# own calendar breaks it, where a large one only costs storage.
_ICS_MAXIMUM = 1048576
_SUBSCRIPTION_BYTES_MAXIMUM = 16777216
_COMPONENTS_MAXIMUM = 50
_PROPERTIES_MAXIMUM = 200
_VALUE_MAXIMUM = 65536
_PARAMETER_MAXIMUM = 1024
_SLUG_MAXIMUM = 128
_NAME_MAXIMUM = 100
_RANGE_MAXIMUM = 366 * 86400
_INSTANCES_MAXIMUM = 5000

# Polling a subscription: the interval starts at the base and doubles on every
# fetch that changes nothing, up to the maximum. A manual poll ignores it.
_POLL_BASE = 3600
_POLL_MAXIMUM = 86400
_POLL_BUDGET = 50

# A linked calendar is checked this often, the objects it pulls in one
# multiget, and how many multigets one sync runs before leaving the rest to
# the next. A check that finds nothing changed costs the other server one
# small request.
_LINK_POLL = 300
_LINK_BATCH = 50
_LINK_BATCHES = 20

# A linked calendar synced this recently is left alone when someone looks at
# it: opening the app, bringing it back to the foreground, or a CalDAV client
# checking the collection.
_LINK_FRESH = 60

# Reminders are scheduled per occurrence this far ahead; a fired reminder and
# the calendar listing top the window up.
_REMINDER_WINDOW = 30 * 86400
_REMINDER_TOPUP = 20
# How far past the window a series' next occurrence is looked for: a rule can
# skip years, as one on the 29th of February does.
_REMINDER_REACH = 5 * 366 * 86400
_REMINDER_DEFAULT = 15

_COLOUR_DEFAULT = "#60a5fa"

# A change in the log is kept this long after the event is deleted.
_TOMBSTONE_RETENTION = 7776000
# Events removed per statement when many go at once, well inside SQLite's
# parameter limit.
_REMOVE_BATCH = 500

def database_upgrade(version):
	if version == 2:
		# A linked calendar: the connected account it syncs through and the
		# collection it mirrors; on each event, the object's address and
		# version on the other server, and whether a write is still to push.
		# Guarded per column, so a database created with them already there
		# and a partly applied run both pass.
		calendars = [c["name"] for c in mochi.db.table("calendars")]
		for column, definition in [("account", "text not null default ''"), ("collection", "text not null default ''")]:
			if column not in calendars:
				mochi.db.execute("alter table calendars add column " + column + " " + definition)
		events = [c["name"] for c in mochi.db.table("events")]
		for column, definition in [("href", "text not null default ''"), ("remote", "text not null default ''"), ("dirty", "integer not null default 0")]:
			if column not in events:
				mochi.db.execute("alter table events add column " + column + " " + definition)
	if version == 3:
		# A linked calendar whose collection the other server does not let
		# this account write: read-only here too.
		if "readonly" not in [c["name"] for c in mochi.db.table("calendars")]:
			mochi.db.execute("alter table calendars add column readonly integer not null default 0")
	if version == 4:
		# Reminders keyed by the moment they fall due as well as the
		# occurrence, so each of an event's reminders has its own row and its
		# job can be cancelled. The rows are rebuilt from the scheduler's own
		# jobs, which takes in the jobs earlier edits left behind: one for an
		# event that is gone or a reminder the event no longer has is
		# cancelled, as is a second job for the same moment.
		if "due" not in [c["name"] for c in mochi.db.table("reminders")]:
			mochi.db.execute("drop table reminders")
			reminders_create()
			offsets = {}
			for job in mochi.schedule.list():
				if job.event != "schedule_reminder":
					continue
				event = job.data.get("event", "")
				instance = int(job.data.get("instance", 0))
				if event not in offsets:
					row = mochi.db.row("select ics from events where id=? and component='VEVENT'", event)
					alarms = event_alarms(mochi.ical.parse(row["ics"]) or {}) if row else []
					offsets[event] = [alarm["offset"] for alarm in alarms if alarm.get("related") == "start"]
				if job.due - instance not in offsets[event] or mochi.db.exists("select 1 from reminders where event=? and instance=? and due=?", event, instance, job.due):
					job.cancel()
					continue
				mochi.db.execute("insert into reminders ( event, instance, due, schedule ) values ( ?, ?, ?, ? )", event, instance, job.due, job.id)
	if version == 5:
		# Each event with an alarm is scheduled again: earlier versions never
		# scheduled the reminders of events further away than the window when
		# written, of a series whose next occurrence lay beyond it, or of alarms
		# after the start or at a fixed time, and put one relative to the end at
		# the start.
		for row in mochi.db.rows("select * from events where component='VEVENT' and ics like '%BEGIN:VALARM%' and ( recurring=1 or finish>=? )", mochi.time.now()):
			reminders_schedule(row)
	if version == 6:
		# A changed occurrence reminds by its own alarms, not the series': each
		# series with an alarm is scheduled again, dropping the reminders earlier
		# versions scheduled from the series for occurrences that change them.
		for row in mochi.db.rows("select * from events where component='VEVENT' and recurring=1 and ics like '%BEGIN:VALARM%'"):
			reminders_schedule(row)
	if version == 7:
		# Every event write replaces the event's change row, found by event.
		mochi.db.execute("create index if not exists changes_event on changes( event )")
	if version == 8:
		# When each event's last occurrence finishes, worked out once as it is
		# written rather than by expanding every series whenever the list view
		# asks where the events end.
		if "ends" not in [c["name"] for c in mochi.db.table("events")]:
			mochi.db.execute("alter table events add column ends integer not null default 0")
		mochi.db.execute("update events set ends=max(start, finish) where recurring=0")
		for row in mochi.db.rows("select id, ics, component, start, finish, recurring from events where recurring=1"):
			mochi.db.execute("update events set ends=? where id=?", event_ends(row["ics"], row), row["id"])

def database_create():
	mochi.db.execute("create table if not exists calendars ( id text not null primary key, identity text not null, slug text not null default '', kind text not null default 'own', colour text not null default '', url text not null default '', etag text not null default '', modified text not null default '', interval integer not null default 3600, next integer not null default 0, fetched integer not null default 0, failure text not null default '', version integer not null default 0, created integer not null default 0, updated integer not null default 0, account text not null default '', collection text not null default '', readonly integer not null default 0 )")
	mochi.db.execute("create index if not exists calendars_identity on calendars( identity )")
	mochi.db.execute("create unique index if not exists calendars_identity_slug on calendars( identity, slug )")
	# ics holds the object's iCalendar text; the rest are read from it when it
	# is written, for listing and the CalDAV time-range prefilter. A recurring
	# event's finish is 0: open-ended. ends is when its last occurrence
	# finishes, -1 for a series with no end.
	mochi.db.execute("create table if not exists events ( id text not null primary key, calendar text not null, identity text not null, slug text not null default '', uid text not null default '', etag text not null default '', ics text not null default '', component text not null default 'VEVENT', summary text not null default '', start integer not null default 0, finish integer not null default 0, allday integer not null default 0, recurring integer not null default 0, created integer not null default 0, updated integer not null default 0, href text not null default '', remote text not null default '', dirty integer not null default 0, ends integer not null default 0 )")
	mochi.db.execute("create index if not exists events_calendar_start on events( calendar, start )")
	mochi.db.execute("create unique index if not exists events_calendar_slug on events( calendar, slug )")
	mochi.db.execute("create unique index if not exists events_calendar_uid on events( calendar, uid ) where uid != ''")
	# Every event write, latest per event, for -/events/changes; pruned holds
	# how far deletions have been forgotten.
	mochi.db.execute("create table if not exists changes ( id integer primary key autoincrement, identity text not null, calendar text not null, event text not null, deleted integer not null default 0, created integer not null default 0 )")
	mochi.db.execute("create index if not exists changes_identity on changes( identity, id )")
	mochi.db.execute("create index if not exists changes_event on changes( event )")
	mochi.db.execute("create table if not exists pruned ( identity text not null primary key, change integer not null default 0 )")
	# The token behind a calendar's ICS link, hash only: the link cannot be
	# shown again, only replaced.
	mochi.db.execute("create table if not exists links ( hash text not null primary key, calendar text not null, created integer not null default 0 )")
	mochi.db.execute("create unique index if not exists links_calendar on links( calendar )")
	reminders_create()
	# One poll at a time per subscription.
	mochi.db.execute("create table if not exists polls ( calendar text not null primary key, token text not null, expires integer not null default 0 )")

# === Helpers ===

def slug_valid(s):
	if type(s) != "string" or not s or len(s) > _SLUG_MAXIMUM:
		return False
	for c in s.elems():
		if c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~@+=-":
			return False
	return True

def property_name_valid(name):
	if type(name) != "string" or not name or len(name) > 64:
		return False
	for c in name.elems():
		if c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-":
			return False
	return True

def colour_valid(colour):
	if type(colour) != "string" or len(colour) != 7 or not colour.startswith("#"):
		return False
	for c in colour[1:].elems():
		if c not in "0123456789abcdef":
			return False
	return True

# length(s) -> int: how many characters s holds. len counts UTF-8 bytes, so a
# limit a person types against, and every client counts in characters, is
# measured here.
def length(s):
	return len(list(s.codepoints()))

def name_input(a, key="name"):
	name = a.input(key, "").strip()
	if not name:
		a.error.label(400, "errors.name_is_required")
		return None
	if length(name) > _NAME_MAXIMUM or not mochi.text.valid(name, "name"):
		a.error.label(400, "errors.invalid_name")
		return None
	return name

def body_json(a):
	if not a.body:
		return None
	body = json.decode(a.body, None)
	return body if type(body) == "dict" else None

def islist(v):
	return type(v) in ("list", "tuple")

def property_value(component, name):
	for p in component.get("properties", []):
		if type(p) == "dict" and p.get("name") == name:
			return p.get("value", "")
	return ""

def property_set(component, name, value):
	kept = [p for p in component.get("properties", []) if type(p) == "dict" and p.get("name") != name]
	kept.append({"name": name, "params": {}, "value": value})
	component["properties"] = kept

def calendar_wrap(components, timezones=[]):
	return {"name": "VCALENDAR", "properties": [
		{"name": "VERSION", "params": {}, "value": "2.0"},
		{"name": "PRODID", "params": {}, "value": _PRODID},
	], "components": list(timezones) + list(components)}

# timezones_named(components, present) -> list: a VTIMEZONE for every zone the
# components' TZID parameters name that `present` (VTIMEZONE components, or a
# dict of them by TZID) does not already hold, from the zone database. An
# object that names a zone must carry its VTIMEZONE, which the editors do not
# send; a name the database does not know gets none.
def timezones_named(components, present=[]):
	held = {}
	for tz in (present.values() if type(present) == "dict" else present):
		if type(tz) == "dict":
			held[property_value(tz, "TZID")] = True
	out = []
	for name in zones(components):
		if name not in held:
			tz = mochi.ical.timezone(name)
			if tz:
				out.append(tz)
	return out

# zones(components) -> list: the zones the components' TZID parameters name,
# each once.
def zones(components):
	named = {}
	# The components and their children, walked without recursion, which
	# Starlark refuses: an override's alarm sits two levels down.
	pending = [c for c in components if type(c) == "dict"]
	while pending:
		component = pending.pop()
		for p in component.get("properties", []):
			if type(p) != "dict":
				continue
			for name in (p.get("params") or {}).get("TZID", []):
				if name:
					named[name] = True
		pending.extend([c for c in component.get("components", []) if type(c) == "dict"])
	return list(named.keys())

# decimal(value) -> bool: whether value is a non-empty ASCII decimal string.
# isdigit() also accepts other scripts' digits (Arabic-Indic, Devanagari),
# which int() rejects, so a guard built on it lets them through to an abort.
def decimal(value):
	if not value:
		return False
	for c in value.elems():
		if c not in "0123456789":
			return False
	return True

# duration_seconds(text) -> int or None: an iCalendar duration such as -PT15M,
# -P1D or PT0S, as signed seconds.
def duration_seconds(text):
	if type(text) != "string" or not text:
		return None
	sign = 1
	if text.startswith("-"):
		sign = -1
		text = text[1:]
	elif text.startswith("+"):
		text = text[1:]
	if not text.startswith("P"):
		return None
	text = text[1:]
	total = 0
	number = ""
	time = False
	for c in text.elems():
		if c in "0123456789":
			number += c
		elif c == "T":
			time = True
		elif c in "WDHMS":
			if not number:
				return None
			n = int(number)
			number = ""
			if c == "W":
				total += n * 604800
			elif c == "D":
				total += n * 86400
			elif c == "H":
				total += n * 3600
			elif c == "M":
				total += n * 60 if time else 0
			elif c == "S":
				total += n
		else:
			return None
	return sign * total

# === Calendars ===

def calendar_get(identity, id):
	if not id or type(id) != "string" or len(id) > 64:
		return None
	row = mochi.db.row("select * from calendars where identity=? and id=?", identity, id)
	if row:
		return row
	if mochi.text.valid(id, "fingerprint"):
		for row in mochi.db.rows("select * from calendars where identity=?", identity):
			if mochi.entity.fingerprint(row["id"]) == id:
				return row
	return None

def calendar_by_slug(identity, slug):
	if not slug_valid(slug):
		return None
	return mochi.db.row("select * from calendars where identity=? and slug=?", identity, slug)

# ignore: let the unique index on (identity, slug) settle a race between two
# creators of the same slug; the caller reads the slug back to learn who won.
def calendar_insert(identity, id, slug, kind, colour, url="", ignore=False, account="", collection="", readonly=False):
	now = mochi.time.now()
	mochi.db.execute("insert" + (" or ignore" if ignore else "") + " into calendars ( id, identity, slug, kind, colour, url, interval, next, created, updated, account, collection, readonly ) values ( ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ? )",
		id, identity, slug, kind, colour, url, _LINK_POLL if kind == "linked" else _POLL_BASE, now, now, account, collection, 1 if readonly else 0)
	devices_sync()

# calendars_ensure(identity): the default calendar and the birthdays calendar
# exist from the first request on, each an entity with a fixed slug.
def calendars_ensure(identity):
	calendar_ensure(identity, "default", "calendar.default", "own", _COLOUR_DEFAULT)
	calendar_ensure(identity, "birthdays", "calendar.birthdays", "birthdays", "#f472b6")

# One fixed-slug calendar, created on first use. An identity's first requests
# race here - the calendar page loads its calendars and its events together -
# and both find nothing. The unique index on (identity, slug) decides: the
# insert is ignored for the loser, which drops the entity it made. Before this
# the loser's insert failed the whole request.
def calendar_ensure(identity, slug, label, kind, colour):
	if mochi.db.exists("select id from calendars where identity=? and slug=?", identity, slug):
		return
	id = mochi.entity.create("calendar", mochi.app.label(label), "private")
	calendar_insert(identity, id, slug, kind, colour, ignore=True)
	if calendar_by_slug(identity, slug)["id"] != id:
		mochi.entity.delete(id)

# calendar_readonly(row): whether writes are refused here. A linked calendar
# is read-only when its collection is on the other server: known at the link
# from the server's privilege set, or learnt from a refused write.
def calendar_readonly(row):
	if row["kind"] == "own":
		return False
	if row["kind"] == "linked":
		return bool(row["readonly"])
	return True

# calendar_polled(row): whether the calendar is kept up to date on a schedule.
def calendar_polled(row):
	return row["kind"] == "subscription" or row["kind"] == "linked"

def calendar_public(row):
	return {
		"id": row["id"],
		"fingerprint": mochi.entity.fingerprint(row["id"]),
		"slug": row["slug"],
		"name": mochi.entity.name(row["id"]) or "",
		"colour": row["colour"],
		"kind": row["kind"],
		"url": row["url"],
		"account": row["account"],
		"collection": row["collection"],
		"readonly": calendar_readonly(row),
		"default": row["slug"] == "default",
		"version": row["version"],
		"fetched": row["fetched"],
		"failure": row["failure"],
		"created": row["created"],
		"updated": row["updated"],
	}

def calendars_rows(identity):
	rows = mochi.db.rows("select * from calendars where identity=? order by created, id", identity)
	return [r for r in rows if r["slug"] == "default"] + [r for r in rows if r["slug"] != "default"]

# devices_sync(): tell the user's phones their calendars changed, so the Mochi
# app syncs now rather than at its next scheduled sync. Core merges a burst into
# one push; a core that predates the call leaves it to the schedule.
def devices_sync():
	if hasattr(mochi.account, "sync"):
		mochi.account.sync("calendars")

# calendar_touch(calendar, event="", deleted=0): bump the calendar's version,
# the change token DAV clients compare, and log the event's change. One row per
# event is kept, the latest.
def calendar_touch(calendar, event="", deleted=0):
	now = mochi.time.now()
	mochi.db.execute("update calendars set version=version+1, updated=? where id=?", now, calendar)
	if event:
		row = mochi.db.row("select identity from calendars where id=?", calendar)
		if row:
			mochi.db.execute("delete from changes where event=?", event)
			mochi.db.execute("insert into changes ( identity, calendar, event, deleted, created ) values ( ?, ?, ?, ?, ? )", row["identity"], calendar, event, deleted, now)
	devices_sync()

def changes_prune(identity):
	old = mochi.db.row("select max(id) as id from changes where identity=? and deleted=1 and created<?", identity, mochi.time.now() - _TOMBSTONE_RETENTION)
	if not old or not old["id"]:
		return
	mochi.db.execute("delete from changes where identity=? and deleted=1 and id<=?", identity, old["id"])
	mochi.db.execute("insert into pruned ( identity, change ) values ( ?, ? ) on conflict( identity ) do update set change=max( change, excluded.change )", identity, old["id"])

# Deleting a linked calendar unlinks it: the events go here and stay on the
# other server.
def calendar_delete(identity, row):
	events_remove(identity, row["id"])
	for link in mochi.db.rows("select hash from links where calendar=?", row["id"]):
		mochi.token.delete(link["hash"])
	mochi.db.execute("delete from links where calendar=?", row["id"])
	mochi.db.execute("delete from polls where calendar=?", row["id"])
	if calendar_polled(row):
		for se in mochi.schedule.list():
			if se.event == "schedule_calendars_poll" and se.data.get("calendar", "") == row["id"]:
				se.cancel()
	mochi.db.execute("delete from calendars where id=? and identity=?", row["id"], identity)
	mochi.entity.delete(row["id"])
	devices_sync()

# === Events ===

def event_get(identity, id):
	if not id or type(id) != "string" or len(id) > 64:
		return None
	return mochi.db.row("select * from events where identity=? and id=?", identity, id)

def event_by_slug(calendar, slug):
	if not slug_valid(slug):
		return None
	return mochi.db.row("select * from events where calendar=? and slug=?", calendar, slug)

def event_public(row):
	return {
		"id": row["id"],
		"calendar": row["calendar"],
		"slug": row["slug"],
		"uid": row["uid"],
		"etag": row["etag"],
		"component": row["component"],
		"summary": row["summary"],
		"start": row["start"],
		"finish": row["finish"],
		"allday": row["allday"] == 1,
		"recurring": row["recurring"] == 1,
		"created": row["created"],
		"updated": row["updated"],
	}

# event_full(row): the event with its components, each zone in them one a
# client can load: a Windows zone name Outlook writes, unknown to browsers and
# phones, is handed over as its IANA zone, so the editors and the phone read
# the times as meant and a save writes the IANA name. A core that predates
# mochi.ical.resolve hands over the names as written.
def event_full(row):
	out = event_public(row)
	out["ics"] = row["ics"]
	text = row["ics"]
	if hasattr(mochi.ical, "resolve"):
		text = mochi.ical.resolve(text) or text
	tree = mochi.ical.parse(text)
	out["components"] = [c for c in tree.get("components", []) if type(c) == "dict" and c.get("name") != "VTIMEZONE"] if tree else []
	return out

# event_write(identity, calendar, slug, ics, row=None, push=True) -> row or
# string: store an object's text, reading its columns from it. Answers an
# error code when the text is not a calendar object or another object holds
# its uid. In a linked calendar the write goes on to the other server, unless
# it came from there: a conflict there is answered as one here, with the
# other server's version stored in place of the write, and a server that
# cannot be reached leaves the write marked to push at the next sync.
# event_ends(ics, summary) -> int: when the object's last occurrence
# finishes, or -1 for a series with no end. summary holds the object's start,
# finish, component and whether it recurs, as mochi.ical.summary reads them.
# The rule is read through the parser, so a folded line or a parameter on it
# reads as any other; a series with more occurrences than an expansion
# returns ends at the last one it reaches.
def event_ends(ics, summary):
	start = summary.get("start", 0)
	if not summary.get("recurring"):
		return max(start, summary.get("finish", 0))
	tree = mochi.ical.parse(ics) or {}
	for c in tree.get("components", []):
		if type(c) != "dict" or c.get("name") != summary.get("component") or property_value(c, "RECURRENCE-ID"):
			continue
		rule = property_value(c, "RRULE").upper()
		if rule and "UNTIL=" not in rule and "COUNT=" not in rule:
			return -1
		break
	last = start
	for instance in mochi.ical.instances(ics, start, start + 100 * 366 * 86400):
		if instance["finish"] > last:
			last = instance["finish"]
	return last

def event_write(identity, calendar, slug, ics, row=None, push=True):
	if type(ics) != "string" or len(ics) > _ICS_MAXIMUM:
		return "too_large"
	summary = mochi.ical.summary(ics)
	if not summary or not summary.get("component"):
		return "invalid"
	uid = summary.get("uid", "")
	if uid and len(uid) > 255:
		return "invalid"
	other = mochi.db.row("select id from events where calendar=? and uid=? and uid!=''", calendar, uid) if uid else None
	if other and (not row or other["id"] != row["id"]):
		return "duplicate"
	now = mochi.time.now()
	etag = mochi.crypto.hash.sha256(ics)
	ends = event_ends(ics, summary)
	if row:
		mochi.db.execute("update events set uid=?, etag=?, ics=?, component=?, summary=?, start=?, finish=?, allday=?, recurring=?, ends=?, updated=? where id=?",
			uid, etag, ics, summary["component"], summary.get("summary", ""), summary.get("start", 0), summary.get("finish", 0), 1 if summary.get("allday") else 0, 1 if summary.get("recurring") else 0, ends, now, row["id"])
		id = row["id"]
	else:
		id = mochi.uid()
		mochi.db.execute("insert into events ( id, calendar, identity, slug, uid, etag, ics, component, summary, start, finish, allday, recurring, ends, created, updated ) values ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )",
			id, calendar, identity, slug or id, uid, etag, ics, summary["component"], summary.get("summary", ""), summary.get("start", 0), summary.get("finish", 0), 1 if summary.get("allday") else 0, 1 if summary.get("recurring") else 0, ends, now, now)
	calendar_touch(calendar, id)
	after = event_get(identity, id)
	reminders_schedule(after)
	if push:
		holder = mochi.db.row("select * from calendars where id=?", calendar)
		if holder and holder["kind"] == "linked":
			code = linked_push(holder, after)
			if code == "conflict" or code == "readonly":
				return code
			after = event_get(identity, id)
	return after

# event_delete(identity, row, push=True) -> string: remove an object, and in
# a linked calendar remove it from the other server first. Answers "" when
# done, "conflict" when the other server holds a newer version (stored here
# in place of the deleted one), else why the other server refused.
def event_delete(identity, row, push=True):
	if push and row["href"]:
		holder = mochi.db.row("select * from calendars where id=?", row["calendar"])
		if holder and holder["kind"] == "linked":
			result = mochi.caldav.delete(holder["account"], row["href"], row["remote"])
			if result.get("error") == "conflict":
				linked_replace(holder, row)
				return "conflict"
			if linked_forbidden(result):
				return linked_refused(holder, row, False)
			if result.get("error"):
				return linked_failure(result)
	reminders_cancel(row["id"])
	mochi.db.execute("delete from events where id=? and identity=?", row["id"], identity)
	calendar_touch(row["calendar"], row["id"], 1)
	changes_prune(identity)
	return ""

# events_remove(identity, calendar, ids=None): remove a calendar's events in
# bulk, every one or those named, as event_delete does one at a time: their
# reminders cancelled and a deletion logged for each, then the calendar touched
# and the log pruned once. Nothing is sent to a linked calendar's server.
def events_remove(identity, calendar, ids=None):
	if ids == None:
		chunks = [None]
	else:
		chunks = [ids[i:i + _REMOVE_BATCH] for i in range(0, len(ids), _REMOVE_BATCH)]
	if not chunks:
		return
	now = mochi.time.now()
	for chunk in chunks:
		where = "identity=? and calendar=?"
		args = [identity, calendar]
		if chunk != None:
			where += " and id in (" + ", ".join(["?"] * len(chunk)) + ")"
			args += chunk
		chosen = "select id from events where " + where
		for row in mochi.db.rows("select schedule from reminders where schedule>0 and event in (" + chosen + ")", *args):
			mochi.schedule.cancel(row["schedule"])
		mochi.db.execute("delete from reminders where event in (" + chosen + ")", *args)
		mochi.db.execute("delete from changes where event in (" + chosen + ")", *args)
		mochi.db.execute("insert into changes ( identity, calendar, event, deleted, created ) select identity, calendar, id, 1, ? from events where " + where, now, *args)
		mochi.db.execute("delete from events where " + where, *args)
	calendar_touch(calendar)
	changes_prune(identity)

# component_clean(component, depth) -> dict or None: a client's component tree
# in stored form. Names are the format's tokens; every value a string; only
# VEVENT at the top and VALARM beneath it.
def component_clean(component, depth=0):
	if type(component) != "dict":
		return None
	name = component.get("name")
	if not property_name_valid(name):
		return None
	if depth == 0 and name != "VEVENT":
		return None
	if depth == 1 and name != "VALARM":
		return None
	if depth > 1:
		return None
	properties = component.get("properties", [])
	if properties == None:
		properties = []
	if not islist(properties) or len(properties) > _PROPERTIES_MAXIMUM:
		return None
	clean = []
	for p in properties:
		if type(p) != "dict":
			return None
		pname = p.get("name")
		if not property_name_valid(pname):
			return None
		value = p.get("value", "")
		if type(value) != "string" or len(value) > _VALUE_MAXIMUM:
			return None
		params = p.get("params", {})
		if params == None:
			params = {}
		if type(params) != "dict":
			return None
		kept = {}
		for key in sorted(params.keys()):
			if not property_name_valid(key):
				return None
			values = params[key]
			if type(values) == "string":
				values = [values]
			if not islist(values):
				return None
			out = []
			for v in values:
				if type(v) != "string" or len(v) > _PARAMETER_MAXIMUM:
					return None
				out.append(v)
			kept[key] = out
		clean.append({"name": pname, "params": kept, "value": value})
	children = component.get("components", [])
	if children == None:
		children = []
	if not islist(children) or len(children) > _COMPONENTS_MAXIMUM:
		return None
	sub = []
	for child in children:
		c = component_clean(child, depth + 1)
		if c == None:
			return None
		sub.append(c)
	return {"name": name, "properties": clean, "components": sub}

# event_text(components, uid) -> string or None: the iCalendar text for a set
# of VEVENTs sharing one uid, as the web editor submits them: the master and
# its overrides. The server owns UID and DTSTAMP.
def event_text(components, uid):
	if not islist(components) or not components or len(components) > _COMPONENTS_MAXIMUM:
		return None
	clean = []
	stamp = mochi.time.local(mochi.time.now(), "ical")
	for c in components:
		component = component_clean(c)
		if component == None or not property_value(component, "DTSTART"):
			return None
		property_set(component, "UID", uid)
		property_set(component, "DTSTAMP", stamp)
		clean.append(component)
	text = mochi.ical.format(calendar_wrap(clean, timezones_named(clean)))
	if not text or len(text) > _ICS_MAXIMUM:
		return None
	return text

# === Reminders ===
# Each VALARM schedules a notification per occurrence, at the time its TRIGGER
# names: relative to the occurrence's start or end, or fixed. A changed or
# deleted event cancels its own.

# One row per reminder of an occurrence, keyed by when it falls due, so a
# changed event can cancel every one of its own.
def reminders_create():
	mochi.db.execute("create table if not exists reminders ( event text not null, instance integer not null, due integer not null, schedule integer not null default 0, primary key ( event, instance, due ) )")

def reminders_cancel(event):
	for row in mochi.db.rows("select schedule from reminders where event=?", event):
		if row["schedule"] > 0:
			mochi.schedule.cancel(row["schedule"])
	mochi.db.execute("delete from reminders where event=?", event)

# event_alarms(tree) -> list: the event's alarms, each {"related": "start" or
# "end", "offset": seconds} for a trigger relative to an occurrence, or {"at":
# seconds} for one at a fixed time. Read from the master, the component with no
# RECURRENCE-ID; overrides carry its alarms in practice.
def event_alarms(tree):
	events = [c for c in tree.get("components", []) if type(c) == "dict" and c.get("name") == "VEVENT"]
	masters = [c for c in events if not property_value(c, "RECURRENCE-ID")]
	source = masters[0] if masters else (events[0] if events else None)
	alarms = []
	if not source:
		return alarms
	for alarm in source.get("components", []):
		if type(alarm) != "dict" or alarm.get("name") != "VALARM":
			continue
		trigger = None
		for p in alarm.get("properties", []):
			if type(p) == "dict" and p.get("name") == "TRIGGER":
				trigger = p
				break
		if not trigger:
			continue
		params = trigger.get("params") or {}
		value = trigger.get("value", "")
		seconds = None
		if "DATE-TIME" not in [v.upper() for v in params.get("VALUE", [])]:
			seconds = duration_seconds(value)
		if seconds != None:
			related = "end" if "END" in [v.upper() for v in params.get("RELATED", [])] else "start"
			entry = {"related": related, "offset": seconds}
		else:
			at = mochi.time.parse(value, "ical")
			if at == None:
				continue
			entry = {"at": at}
		if entry not in alarms:
			alarms.append(entry)
	return alarms

# alarm_due(alarm, occurrence) -> int: when the alarm falls due for the occurrence.
def alarm_due(alarm, occurrence):
	if "at" in alarm:
		return alarm["at"]
	if alarm["related"] == "end":
		return occurrence["finish"] + alarm["offset"]
	return occurrence["start"] + alarm["offset"]

# reminder_add(row, occurrence, due, now) -> bool: schedule one reminder unless
# it is past or already scheduled; whether it is still to come.
def reminder_add(row, occurrence, due, now):
	if due < now:
		return False
	if not mochi.db.exists("select 1 from reminders where event=? and instance=? and due=?", row["id"], occurrence["start"], due):
		scheduled = mochi.schedule.at("schedule_reminder", {"event": row["id"], "instance": occurrence["start"]}, due)
		mochi.db.execute("insert into reminders ( event, instance, due, schedule ) values ( ?, ?, ?, ? )", row["id"], occurrence["start"], due, scheduled.id if scheduled else 0)
	return True

# reminders_add(row, after): schedule the event's reminders still to come for
# its occurrences from after to the end of the window, each occurrence by its
# own alarms: an override's for the occurrence it changes, which replaces it
# whole, so one with none reminds of nothing, and the event's for the rest. A
# one-off event's are scheduled however far away it is. A series with none
# left in the window keeps its next occurrence's scheduled, however far away,
# so each reminder that fires schedules the next. An alarm at a fixed time
# goes with the occurrence it comes before, when that occurrence has it.
# Scheduling what is already scheduled does nothing.
def reminders_add(row, after):
	if row["component"] != "VEVENT" or "BEGIN:VALARM" not in row["ics"]:
		return
	now = mochi.time.now()
	if row["recurring"] != 1:
		for occurrence in mochi.ical.instances(row["ics"], alarms=True):
			for alarm in occurrence["alarms"]:
				reminder_add(row, occurrence, alarm_due(alarm, occurrence), now)
		return
	pending = False
	relative = False
	listed = False
	fixed = []
	for occurrence in mochi.ical.instances(row["ics"], after, now + _REMINDER_WINDOW, alarms=True):
		listed = True
		for alarm in occurrence["alarms"]:
			if "at" in alarm:
				if alarm["at"] not in fixed:
					fixed.append(alarm["at"])
				continue
			relative = True
			if reminder_add(row, occurrence, alarm_due(alarm, occurrence), now):
				pending = True
	if not pending and (relative or not listed):
		beyond = max(after, now + _REMINDER_WINDOW)
		for occurrence in mochi.ical.instances(row["ics"], beyond, beyond + _REMINDER_REACH, alarms=True):
			found = False
			for alarm in occurrence["alarms"]:
				if "at" in alarm:
					if alarm["at"] not in fixed:
						fixed.append(alarm["at"])
				elif reminder_add(row, occurrence, alarm_due(alarm, occurrence), now):
					found = True
			if found:
				break
	for at in fixed:
		for occurrence in mochi.ical.instances(row["ics"], at, at + _REMINDER_REACH, alarms=True):
			if {"at": at} in occurrence["alarms"]:
				reminder_add(row, occurrence, at, now)
			break

def reminders_schedule(row):
	if not row:
		return
	reminders_cancel(row["id"])
	reminders_add(row, mochi.time.now())

def schedule_reminder(e):
	if e.source != "schedule":
		return
	data = e.data
	row = event_get(e.user.identity.id, data.get("event", "")) if e.user else None
	# The job's data comes back as JSON numbers, so the start is a float.
	instance = int(data.get("instance", 0))
	mochi.db.execute("delete from reminders where event=? and instance=? and due=?", data.get("event", ""), instance, e.due)
	if not row:
		return
	# The occurrence must still exist: the event may have moved since.
	found = None
	for occurrence in mochi.ical.instances(row["ics"], instance, instance + 1):
		if occurrence["start"] == instance:
			found = occurrence
	if not found:
		return
	title = row["summary"] or mochi.app.label("notifications.reminder.untitled")
	# The time as the calendar shows it: in the event's own zone when the user
	# shows events in their zones, else in the user's.
	zone = ""
	if preferences_load(e.user)["zones"]:
		zone = found.get("zone", {}).get("start", "")
	body = reminder_body(found, zone)
	# The day the occurrence is on, opened at the event itself.
	url = "/calendars/?view=day&date=" + mochi.time.local(instance, "date", timezone=zone) + "&event=" + row["id"] + "&occurrence=" + str(instance)
	# Keyed by when this reminder falls due: the notifications service takes a
	# key it has seen for a retry, so the occurrence's other reminders need
	# keys of their own.
	mochi.service.call("notifications", "send", "reminder", row["id"], title, body, url,
		mochi.app.label("notifications.topic.reminder"), event=row["id"] + ":" + str(instance) + ":" + str(e.due))
	# A series schedules its next reminders as each one fires.
	if row["recurring"] == 1:
		reminders_topup(row)

# reminder_body(occurrence, zone) -> string: when the occurrence starts, as the
# user reads it in zone: the time if it is today, tomorrow and the time, or its
# date and the time; an all-day event's day alone.
def reminder_body(occurrence, zone):
	now = mochi.time.now()
	today = mochi.time.local(now, "date", timezone=zone)
	# The next day by the calendar, not twenty-four hours on: a day can have 23
	# or 25 hours.
	tomorrow = mochi.time.local(mochi.time.parse(today.replace("-", ""), "ical") + 86400, "date", timezone="UTC")
	if occurrence.get("allday"):
		day = occurrence.get("date") or mochi.time.local(occurrence["start"], "date")
		if day == today:
			return mochi.app.label("notifications.reminder.allday.today")
		if day == tomorrow:
			return mochi.app.label("notifications.reminder.allday.tomorrow")
		return mochi.app.label("notifications.reminder.allday.later", date=mochi.time.local(occurrence["start"], "day"))
	day = mochi.time.local(occurrence["start"], "date", timezone=zone)
	time = mochi.time.local(occurrence["start"], "clock", timezone=zone)
	if day == today:
		return mochi.app.label("notifications.reminder.body", time=time)
	if day == tomorrow:
		return mochi.app.label("notifications.reminder.tomorrow", time=time)
	return mochi.app.label("notifications.reminder.later", date=mochi.time.local(occurrence["start"], "day", timezone=zone), time=time)

def reminders_topup(row):
	latest = mochi.db.row("select max(instance) as instance from reminders where event=?", row["id"])
	reminders_add(row, latest["instance"] if latest and latest["instance"] else mochi.time.now())

# reminders_ensure(identity): recurring events whose scheduled reminders run
# out within half the window get more, a few per request.
def reminders_ensure(identity):
	horizon = mochi.time.now() + _REMINDER_WINDOW / 2
	count = 0
	for row in mochi.db.rows("select e.* from events e where e.identity=? and e.recurring=1 and e.component='VEVENT' and exists ( select 1 from reminders r where r.event=e.id ) and ( select max(instance) from reminders r where r.event=e.id ) < ? limit ?", identity, horizon, _REMINDER_TOPUP):
		reminders_topup(row)
		count += 1
	return count

# === Birthdays ===

# The people service refuses the call without contacts/read, and that refusal
# would fail the whole listing every view asks for, so a server that has not
# granted it gets an empty birthdays calendar rather than no calendar at all.
def birthdays_contacts(identity):
	if not identity or not mochi.service.exists("contacts"):
		return []
	if not mochi.permission.check("contacts/read"):
		return []
	return mochi.service.call("contacts", "contacts/birthdays", identity) or []

# date_text(year, month, day) -> string: the iCalendar DATE form, padded by
# hand because Starlark's % formatting takes no width.
def date_text(year, month, day):
	return ("0000" + str(year))[-4:] + ("00" + str(month))[-2:] + ("00" + str(day))[-2:]

def birthday_date(year, month, day):
	if month == 2 and day == 29:
		stamp = mochi.time.parse(date_text(year, 2, 28), "ical")
		leap = mochi.time.parse(date_text(year, 2, 29), "ical")
		return leap if leap else stamp
	return mochi.time.parse(date_text(year, month, day), "ical")

# birthday_today() -> string: today's date in the user's zone, the first day a
# birthday is shown on: one already past is not.
def birthday_today():
	return mochi.time.local(mochi.time.now(), "date")

# birthday_next(contact, today) -> int | None: the contact's first birthday on
# or after today and not before the year they were born, as midnight UTC of
# its date.
def birthday_next(contact, today):
	year = max(int(today[:4]), contact["year"])
	for candidate in range(year, year + 2):
		day = birthday_date(candidate, contact["month"], contact["day"])
		if day != None and mochi.time.local(day, "date", timezone="UTC") >= today:
			return day
	return None

# birthdays_instances(start, finish, colour, calendar) -> list: one all-day
# occurrence per contact per year in the range, from the year the contact was
# born and from today. A birthday is a date rather than a moment, so its date
# is read as written, not moved into the user's zone.
def birthdays_instances(identity, start, finish, colour, calendar):
	out = []
	today = birthday_today()
	first = int(mochi.time.local(start, "date")[:4]) - 1
	last = int(mochi.time.local(finish, "date")[:4]) + 1
	for contact in birthdays_contacts(identity):
		for year in range(max(first, contact["year"]), last + 1):
			day = birthday_date(year, contact["month"], contact["day"])
			if day == None or day + 86400 <= start or day >= finish:
				continue
			date = mochi.time.local(day, "date", timezone="UTC")
			if date < today:
				continue
			out.append({
				"event": "birthday-" + contact["id"],
				"calendar": calendar,
				"uid": "birthday-" + contact["id"],
				"summary": mochi.app.label("birthday.summary", name=contact["name"]),
				"location": "", "description": "", "status": "",
				"start": day, "finish": day + 86400, "allday": True, "date": date,
				"recurring": True, "exception": False, "colour": colour, "readonly": True,
			})
	return out

# birthday_object(contact) -> dict: the contact's birthday as a yearly event
# for CalDAV and the calendar's address, starting at its next occurrence so a
# client shows none already past. The start therefore moves on the day after
# each birthday, and the object's etag with it. A 29 February birthday starts
# on the next 29 February, since a yearly rule from it skips the other years.
def birthday_object(contact):
	today = birthday_today().replace("-", "")
	year = max(int(today[:4]), contact["year"])
	start = date_text(year, contact["month"], contact["day"])
	for candidate in range(year, year + 9):
		text = date_text(candidate, contact["month"], contact["day"])
		if mochi.time.parse(text, "ical") != None and text >= today:
			start = text
			break
	uid = "birthday-" + contact["id"] + "@mochi"
	name = mochi.app.label("birthday.summary", name=contact["name"])
	component = {"name": "VEVENT", "properties": [
		{"name": "UID", "params": {}, "value": uid},
		{"name": "DTSTAMP", "params": {}, "value": "19700101T000000Z"},
		{"name": "DTSTART", "params": {"VALUE": ["DATE"]}, "value": start},
		{"name": "SUMMARY", "params": {}, "value": name},
		{"name": "RRULE", "params": {}, "value": "FREQ=YEARLY"},
		{"name": "TRANSP", "params": {}, "value": "TRANSPARENT"},
	], "components": []}
	ics = mochi.ical.format(calendar_wrap([component]))
	return {"name": contact["id"], "etag": mochi.crypto.hash.sha256(ics), "updated": 0, "ics": ics}

# === Subscriptions ===

# ics_groups(tree) -> (list, dict): the objects of a parsed iCalendar text as
# (uid, components) pairs in the order they first appear, grouped by uid so a
# recurring event and its changed occurrences stay one object, and the text's
# VTIMEZONEs by TZID. A component with no uid is keyed by a hash of itself and
# given that hash as its uid: an object cannot be written without one, and the
# same text read again gives the same hash, so it is found again rather than
# written twice.
def ics_groups(tree):
	timezones = {}
	for c in tree.get("components", []):
		if type(c) == "dict" and c.get("name") == "VTIMEZONE":
			timezones[property_value(c, "TZID")] = c
	groups = {}
	order = []
	for c in tree.get("components", []):
		if type(c) != "dict" or c.get("name") not in ("VEVENT", "VTODO", "VJOURNAL"):
			continue
		uid = property_value(c, "UID")
		if not uid:
			uid = mochi.crypto.hash.sha256(json.encode(c))[:32]
			property_set(c, "UID", uid)
		if uid not in groups:
			groups[uid] = []
			order.append(uid)
		groups[uid].append(c)
	return [(uid, groups[uid]) for uid in order], timezones

# group_text(components, timezones) -> string: one object's text. It carries
# the zones it names, the source's own where it has them: a source's full set
# in every object multiplies its storage.
def group_text(components, timezones):
	named = [timezones[name] for name in zones(components) if name in timezones]
	return mochi.ical.format(calendar_wrap(components, named + timezones_named(components, named)))

# subscription_ingest(row, text) -> int or string: replace a subscription's
# events with those in the fetched text. Returns the count, or an error code.
def subscription_ingest(row, text):
	if type(text) != "string" or len(text) > _SUBSCRIPTION_BYTES_MAXIMUM:
		return "too_large"
	tree = mochi.ical.parse(text)
	if not tree:
		return "invalid"
	groups, timezones = ics_groups(tree)
	identity = row["identity"]
	seen = {}
	for uid, components in groups:
		ics = group_text(components, timezones)
		if not ics or len(ics) > _ICS_MAXIMUM:
			continue
		slug = mochi.crypto.hash.sha256(uid)[:32]
		existing = event_by_slug(row["id"], slug)
		if existing and existing["etag"] == mochi.crypto.hash.sha256(ics):
			seen[existing["id"]] = True
			continue
		written = event_write(identity, row["id"], slug, ics, existing)
		if type(written) == "dict":
			seen[written["id"]] = True
	gone = [event["id"] for event in mochi.db.rows("select id from events where calendar=?", row["id"]) if event["id"] not in seen]
	events_remove(identity, row["id"], gone)
	return len(seen)

def header_value(headers, name):
	if type(headers) != "dict":
		return ""
	for key in headers.keys():
		if key.lower() == name:
			value = headers[key]
			return value if type(value) == "string" else ""
	return ""

# subscription_fetch(row, force=False) -> bool: fetch the URL, conditional on
# what the last fetch reported, and ingest a changed body. Backs off on no
# change or failure. Returns whether anything changed.
def subscription_fetch(row, force=False):
	headers = {}
	if row["etag"] and not force:
		headers["If-None-Match"] = row["etag"]
	if row["modified"] and not force:
		headers["If-Modified-Since"] = row["modified"]
	response = mochi.url.get(row["url"], {}, headers)
	status = response.get("status", 0) if response else 0
	now = mochi.time.now()
	changed = False
	interval = min(row["interval"] * 2, _POLL_MAXIMUM)
	failure = ""
	if status == 304:
		pass
	elif status >= 200 and status < 300:
		result = subscription_ingest(row, response.get("body", ""))
		if type(result) == "string":
			failure = result
		else:
			changed = True
			interval = _POLL_BASE
			mochi.db.execute("update calendars set etag=?, modified=? where id=?", header_value(response.get("headers"), "etag"), header_value(response.get("headers"), "last-modified"), row["id"])
	else:
		failure = "status:" + str(status)
	mochi.db.execute("update calendars set interval=?, next=?, fetched=?, failure=? where id=?", interval, now + interval, now, failure, row["id"])
	return changed

# === Linked calendars ===
# A linked calendar mirrors one collection on another CalDAV server, reached
# through a connected account core holds the credential for. Each event keeps
# the object's address there and the version the server last answered, and a
# write that could not be pushed is marked dirty for the next sync.

def linked_failure(result):
	code = result.get("error", "") or "transport"
	if "status" in result:
		return code + ":" + str(result["status"])
	return code

# linked_push(calendar, event) -> string: write the event to the other
# server. "" when it took; "conflict" when the server holds a version this one
# did not know, which then replaces the event here; else why it failed, with
# the event marked to push later.
def linked_push(calendar, event):
	href = event["href"] or (calendar["collection"] + event["slug"] + ".ics")
	result = mochi.caldav.put(calendar["account"], href, event["ics"], event["remote"])
	if not result.get("error"):
		mochi.db.execute("update events set href=?, remote=?, dirty=0 where id=?", href, result.get("etag", ""), event["id"])
		return ""
	if result["error"] == "conflict":
		linked_replace(calendar, dict(event, href=href))
		return "conflict"
	if linked_forbidden(result):
		return linked_refused(calendar, dict(event, href=href), not event["href"])
	mochi.db.execute("update events set dirty=1 where id=?", event["id"])
	mochi.db.execute("update calendars set failure=? where id=?", linked_failure(result), calendar["id"])
	return linked_failure(result)

# linked_forbidden(result) -> bool: the other server refused the write as
# forbidden, the account's credential being good.
def linked_forbidden(result):
	return result.get("error") == "unauthorised" and result.get("status") == 403

# linked_refused(calendar, event, created) -> "readonly": the other server
# refused a write. The server's version takes the event's place here, so no
# edit is left stranded; and the calendar becomes read-only when the server
# says its collection is, or when what it refused was a new object, which a
# collection this account may write never refuses. A refused edit or delete
# on a server that says nothing is put back and reported alone: it may be
# that one object the account may not change.
def linked_refused(calendar, event, created):
	linked_replace(calendar, event)
	readonly = created
	if not readonly:
		for remote in mochi.caldav.calendars(calendar["account"]).get("calendars", []):
			if remote["href"] == calendar["collection"] and remote.get("readonly"):
				readonly = True
	if readonly:
		mochi.db.execute("update calendars set readonly=1 where id=?", calendar["id"])
	return "readonly"

# linked_replace(calendar, event): the other server's version of the object
# takes the place of the event here, or the event goes when the server no
# longer holds it.
def linked_replace(calendar, event):
	got = mochi.caldav.get(calendar["account"], calendar["collection"], [event["href"]])
	if got.get("error"):
		return
	objects = [o for o in got.get("objects", []) if o.get("ics")]
	if not objects:
		event_delete(calendar["identity"], event, push=False)
		return
	written = event_write(calendar["identity"], calendar["id"], event["slug"], objects[0]["ics"], event, push=False)
	if type(written) == "dict":
		mochi.db.execute("update events set href=?, remote=?, dirty=0 where id=?", event["href"], objects[0].get("etag", ""), written["id"])

# linked_pull(row) -> (bool, bool) or string: bring the collection's objects
# in: fetch those whose version moved or that are new, drop those gone. The
# pair is whether anything changed and whether the whole collection was
# covered; a failure code otherwise.
def linked_pull(row):
	listing = mochi.caldav.list(row["account"], row["collection"])
	if listing.get("error"):
		return linked_failure(listing)
	remote = {}
	for o in listing.get("objects", []):
		remote[o["href"]] = o.get("etag", "")
	local = {}
	for event in mochi.db.rows("select * from events where calendar=?", row["id"]):
		if event["href"]:
			local[event["href"]] = event
	wanted = [href for href in remote if href not in local or local[href]["remote"] != remote[href] or local[href]["dirty"] == 1]
	changed = False
	complete = True
	for i in range(0, len(wanted), _LINK_BATCH):
		if i >= _LINK_BATCH * _LINK_BATCHES:
			complete = False
			break
		got = mochi.caldav.get(row["account"], row["collection"], wanted[i:i + _LINK_BATCH])
		if got.get("error"):
			return linked_failure(got)
		for o in got.get("objects", []):
			if not o.get("ics"):
				continue
			existing = local.get(o["href"])
			slug = existing["slug"] if existing else mochi.crypto.hash.sha256(o["href"])[:32]
			written = event_write(row["identity"], row["id"], slug, o["ics"], existing, push=False)
			if type(written) == "dict":
				mochi.db.execute("update events set href=?, remote=?, dirty=0 where id=?", o["href"], o.get("etag", ""), written["id"])
				changed = True
	gone = [local[href]["id"] for href in local if href not in remote]
	if gone:
		events_remove(row["identity"], row["id"], gone)
		changed = True
	return (changed, complete)

# linked_sync(row, force=False) -> bool: push what is still to push, then
# pull what changed on the other server. The collection's change tag, where
# the server keeps one, skips the pull when nothing moved; a manual sync
# never skips it. Returns whether anything changed here.
def linked_sync(row, force=False):
	changed = False
	failure = ""
	for event in mochi.db.rows("select * from events where calendar=? and dirty=1", row["id"]):
		code = linked_push(row, event)
		if code == "conflict" or code == "readonly":
			changed = True
		elif code:
			failure = code
			break
	for event in mochi.db.rows("select * from events where calendar=? and href='' and dirty=0", row["id"]):
		# Written before the calendar was linked, or by a pull that could
		# not name it: a push gives it an address.
		if failure:
			break
		code = linked_push(row, event)
		if code == "" or code == "readonly":
			changed = True
	if not failure:
		status = mochi.caldav.status(row["account"], row["collection"])
		if status.get("error"):
			failure = linked_failure(status)
		elif force or not status.get("ctag") or status.get("ctag") != row["etag"]:
			result = linked_pull(row)
			if type(result) == "string":
				failure = result
			else:
				changed = changed or result[0]
				if result[1]:
					mochi.db.execute("update calendars set etag=? where id=?", status.get("ctag", ""), row["id"])
	now = mochi.time.now()
	interval = _LINK_POLL if not failure else min(max(row["interval"], _LINK_POLL) * 2, _POLL_MAXIMUM)
	mochi.db.execute("update calendars set interval=?, next=?, fetched=?, failure=? where id=?", interval, now + interval, now, failure, row["id"])
	return changed

# === Polls ===
# A subscription or linked calendar syncs on a schedule, and a linked one
# also when someone looks at it; one lock keeps two syncs apart.

# poll_lock(calendar) -> string or None: take the calendar's sync lock, so a
# scheduled poll and a refresh never sync it at once. The token frees it.
def poll_lock(calendar):
	now = mochi.time.now()
	token = mochi.uid()
	mochi.db.execute("delete from polls where expires <= ?", now)
	mochi.db.execute("insert into polls ( calendar, token, expires ) values ( ?, ?, ? ) on conflict do nothing", calendar, token, now + 400)
	lock = mochi.db.row("select token from polls where calendar=?", calendar)
	if not lock or lock["token"] != token:
		return None
	return token

def poll_unlock(calendar, token):
	mochi.db.execute("delete from polls where calendar=? and token=?", calendar, token)

# linked_stale(row) -> bool: a linked calendar not synced in the last minute.
def linked_stale(row):
	return row["kind"] == "linked" and row["fetched"] < mochi.time.now() - _LINK_FRESH

# linked_refresh(row) -> bool: sync a linked calendar now, for someone looking
# at it, unless it is fresh or already syncing. The scheduled poll carries on
# from the next time the sync sets. Returns whether anything changed.
def linked_refresh(row):
	if not linked_stale(row):
		return False
	calendar = row["id"]
	token = poll_lock(calendar)
	if not token:
		return False
	# Read again under the lock: a sync that finished since may have made it fresh.
	row = mochi.db.row("select * from calendars where id=?", calendar)
	changed = False
	if row and linked_stale(row):
		changed = linked_sync(row)
	poll_unlock(calendar, token)
	return changed

def poll_schedule(calendar, delay):
	mochi.schedule.after("schedule_calendars_poll", {"calendar": calendar}, max(delay, 10))

# poll_booked(calendar) -> bool: whether a poll of the calendar is booked. A
# job is gone from the list once it runs, so a poll never finds itself.
def poll_booked(calendar):
	for se in mochi.schedule.list():
		if se.event == "schedule_calendars_poll" and se.data.get("calendar", "") == calendar:
			return True
	return False

# ensure_polls(): a poll scheduled for every subscription, and the daily
# watchdog that re-creates lost ones. One schedule listing covers them all.
def ensure_polls():
	subscriptions = mochi.db.rows("select id, next from calendars where kind='subscription' or kind='linked'")
	if not subscriptions:
		return
	polled = {}
	watchdog = False
	for se in mochi.schedule.list():
		if se.event == "schedule_calendars_poll":
			polled[se.data.get("calendar", "")] = True
		elif se.event == "schedule_calendars_watchdog":
			watchdog = True
	now = mochi.time.now()
	for row in subscriptions:
		if row["id"] not in polled:
			poll_schedule(row["id"], row["next"] - now)
	if not watchdog:
		mochi.schedule.every("schedule_calendars_watchdog", {}, 86400)

def schedule_calendars_watchdog(e):
	if e.source != "schedule":
		return
	ensure_polls()

def schedule_calendars_poll(e):
	if e.source != "schedule":
		return
	calendar = e.data.get("calendar", "")
	row = mochi.db.row("select * from calendars where id=? and ( kind='subscription' or kind='linked' )", calendar)
	if not row:
		return
	now = mochi.time.now()
	token = poll_lock(calendar)
	if not token:
		# Another sync holds the calendar. The poll carries on only through the
		# job it books next, so one that loses to a refresh, a manual poll or a
		# lock left by a sync that died books a retry. A running poll's safety
		# net is a booked poll, so one that loses to another poll books none.
		if not poll_booked(calendar):
			poll_schedule(calendar, 60)
		return
	safety = mochi.schedule.after("schedule_calendars_poll", {"calendar": calendar}, 360)
	if row["next"] <= now:
		if row["kind"] == "linked":
			linked_sync(row)
		else:
			subscription_fetch(row)
	safety.cancel()
	after = mochi.db.row("select next from calendars where id=?", calendar)
	if after:
		poll_schedule(calendar, after["next"] - mochi.time.now())
	poll_unlock(calendar, token)

# A refresh a CalDAV client's check asked for: one sync, not a schedule of
# its own, which the calendar's scheduled poll already is.
def schedule_calendars_refresh(e):
	if e.source != "schedule":
		return
	row = mochi.db.row("select * from calendars where id=? and kind='linked'", e.data.get("calendar", ""))
	if row:
		linked_refresh(row)

# === Actions: calendars ===

def action_calendars(a):
	identity = a.user.identity.id
	calendars_ensure(identity)
	ensure_polls()
	reminders_ensure(identity)
	return {"data": {"calendars": [calendar_public(row) for row in calendars_rows(identity)]}}

def action_calendar_get(a):
	identity = a.user.identity.id
	row = calendar_get(identity, a.input("calendar", ""))
	if not row:
		a.error.label(404, "errors.calendar_not_found")
		return
	return {"data": {"calendar": calendar_public(row)}}

def colour_input(a, fallback):
	colour = a.input("colour", "").strip().lower()
	if not colour:
		return fallback
	if not colour_valid(colour):
		a.error.label(400, "errors.invalid_colour")
		return None
	return colour

def action_calendar_create(a):
	identity = a.user.identity.id
	calendars_ensure(identity)
	name = name_input(a)
	if name == None:
		return
	colour = colour_input(a, _COLOUR_DEFAULT)
	if colour == None:
		return
	id = mochi.entity.create("calendar", name, "private")
	calendar_insert(identity, id, mochi.entity.fingerprint(id), "own", colour)
	return {"data": {"calendar": calendar_public(calendar_get(identity, id))}}

def action_calendar_rename(a):
	identity = a.user.identity.id
	row = calendar_get(identity, a.input("calendar", ""))
	if not row:
		a.error.label(404, "errors.calendar_not_found")
		return
	name = name_input(a)
	if name == None:
		return
	mochi.entity.update(row["id"], name=name)
	calendar_touch(row["id"])
	return {"data": {"calendar": calendar_public(calendar_get(identity, row["id"]))}}

def action_calendar_colour(a):
	identity = a.user.identity.id
	row = calendar_get(identity, a.input("calendar", ""))
	if not row:
		a.error.label(404, "errors.calendar_not_found")
		return
	colour = colour_input(a, "")
	if not colour:
		if colour == "":
			a.error.label(400, "errors.invalid_colour")
		return
	mochi.db.execute("update calendars set colour=?, updated=? where id=?", colour, mochi.time.now(), row["id"])
	devices_sync()
	return {"data": {"calendar": calendar_public(calendar_get(identity, row["id"]))}}

def action_calendar_delete(a):
	identity = a.user.identity.id
	row = calendar_get(identity, a.input("calendar", ""))
	if not row:
		a.error.label(404, "errors.calendar_not_found")
		return
	if row["slug"] in ("default", "birthdays"):
		a.error.label(400, "errors.calendar_fixed")
		return
	calendar_delete(identity, row)
	return {"data": {}}

# scheme(url) -> string: an address as typed, with https:// in front when it
# names no scheme, so "example.com/caldav" reaches the server it names.
def scheme(url):
	if url and "://" not in url:
		return "https://" + url
	return url

# address_name(url) -> string: the name a calendar takes from its address
# when it has none of its own: the host alone, without the login, port, path
# or query the address may carry, or the default calendar name when the host
# is not a usable name.
def address_name(url):
	rest = url.split("//", 1)[1] if "//" in url else url
	rest = rest.split("/", 1)[0].split("?", 1)[0]
	host = rest.split("@")[-1].split(":", 1)[0]
	if not host or length(host) > _NAME_MAXIMUM or not mochi.text.valid(host, "name"):
		return mochi.app.label("calendar.default")
	return host

def action_calendar_subscribe(a):
	identity = a.user.identity.id
	calendars_ensure(identity)
	url = scheme(a.input("url", "").strip())
	if not url.startswith("http://") and not url.startswith("https://") or not mochi.text.valid(url, "url"):
		a.error.label(400, "errors.url_scheme_required")
		return
	if mochi.db.exists("select id from calendars where identity=? and url=?", identity, url):
		a.error.label(400, "errors.subscription_exists")
		return
	colour = colour_input(a, "#94a3b8")
	if colour == None:
		return
	# The grant is asked for here, before any fetch, so the caller's client can
	# raise the consent dialog and try again.
	mochi.permission.require(url)
	response = mochi.url.get(url)
	status = response.get("status", 0) if response else 0
	if status == 401 or status == 403:
		# A CalDAV address (Google's apidata.googleusercontent.com, an
		# Exchange server) answers with a login challenge; what a subscription
		# takes is the calendar's published iCalendar address.
		a.error.label(400, "errors.calendar_private")
		return
	if status < 200 or status >= 300:
		a.error.label(502, "errors.calendar_fetch_failed", status=str(status))
		return
	body = response.get("body", "")
	tree = mochi.ical.parse(body) if type(body) == "string" and len(body) <= _SUBSCRIPTION_BYTES_MAXIMUM else None
	if not tree:
		a.error.label(502, "errors.calendar_invalid")
		return
	name = a.input("name", "").strip() or property_value(tree, "X-WR-CALNAME").strip()
	if not name or length(name) > _NAME_MAXIMUM or not mochi.text.valid(name, "name"):
		name = address_name(url)
	id = mochi.entity.create("calendar", name, "private")
	calendar_insert(identity, id, mochi.entity.fingerprint(id), "subscription", colour, url)
	row = calendar_get(identity, id)
	result = subscription_ingest(row, body)
	now = mochi.time.now()
	if type(result) == "string":
		mochi.db.execute("update calendars set fetched=?, next=?, failure=? where id=?", now, now + _POLL_BASE, result, id)
	else:
		mochi.db.execute("update calendars set etag=?, modified=?, fetched=?, next=? where id=?", header_value(response.get("headers"), "etag"), header_value(response.get("headers"), "last-modified"), now, now + _POLL_BASE, id)
	poll_schedule(id, _POLL_BASE)
	ensure_polls()
	return {"data": {"calendar": calendar_public(calendar_get(identity, id))}}

# The linked calendars someone is looking at, synced when the last sync is
# more than a minute old: the web and Android clients call this as the app
# opens and as it comes back to the foreground.
def action_calendars_refresh(a):
	changed = False
	for row in calendars_rows(a.user.identity.id):
		if row["kind"] == "linked" and linked_refresh(row):
			changed = True
	return {"data": {"changed": changed}}

def action_calendar_poll(a):
	identity = a.user.identity.id
	row = calendar_get(identity, a.input("calendar", ""))
	if not row or not calendar_polled(row):
		a.error.label(404, "errors.calendar_not_found")
		return
	token = poll_lock(row["id"])
	if not token:
		a.error.label(409, "errors.calendar_syncing")
		return
	if row["kind"] == "linked":
		changed = linked_sync(row, True)
	else:
		changed = subscription_fetch(row, True)
	poll_unlock(row["id"], token)
	return {"data": {"changed": changed, "calendar": calendar_public(calendar_get(identity, row["id"]))}}

# === Actions: linked calendars ===

# The connected accounts a calendar can be linked through, each with the
# capabilities it holds now, and the OAuth providers a new account can be
# granted from.
def action_calendar_accounts(a):
	accounts = []
	for account in mochi.account.list("calendar") or []:
		accounts.append({"id": account["id"], "type": account["type"], "label": account.get("label", ""), "identifier": account.get("identifier", ""), "granted": account.get("granted", [])})
	providers = [p["type"] for p in (mochi.account.providers("calendar") or []) if p.get("flow") == "oauth"]
	# An administrator is offered the system settings where a missing
	# provider's sign-in client is entered; anyone else is told to ask one.
	return {"data": {"accounts": accounts, "providers": providers, "administrator": a.user.role == "administrator"}}

# Start the consent that grants calendar access to an OAuth account: a known
# one, or a new one of the provider. Answers the address the browser visits;
# the provider returns it to the target with granted=calendar and the account.
def action_calendar_grant(a):
	provider = a.input("provider", "")
	account = a.input("account", "")
	target = a.input("target", "")
	if not target.startswith("/") or target.startswith("//"):
		a.error.label(400, "errors.invalid_target")
		return
	if account:
		row = mochi.account.get(account)
		if not row:
			a.error.label(404, "errors.account_not_found")
			return
		provider = row["type"]
	if not provider:
		a.error.label(400, "errors.account_not_found")
		return
	# A native app's consent runs in the system browser and returns on the
	# app's own scheme, bound by its PKCE challenge rather than a session.
	if a.input("mode", "") == "mobile":
		return {"data": mochi.account.grant(provider, "calendar", target, account, scheme=a.input("scheme", ""), challenge=a.input("challenge", ""))}
	return {"data": mochi.account.grant(provider, "calendar", target, account)}

# Connect an account a calendar can be linked through, from the subscribe
# wizard: an Apple ID with an app-specific password, or a CalDAV server with
# a login. The account is tried against its server before it is kept, so a
# wrong password is refused here rather than at the calendar list.
def action_calendar_account(a):
	kind = a.input("type", "")
	if kind != "apple" and kind != "caldav":
		a.error.label(400, "errors.invalid_account")
		return
	fields = {}
	for key in ("url", "username", "password", "label"):
		value = a.input(key, "").strip() if key != "password" else a.input(key, "")
		if len(value) > 4096:
			a.error.label(400, "errors.invalid_account")
			return
		if value:
			fields[key] = value
	if not fields.get("username") or not fields.get("password"):
		a.error.label(400, "errors.invalid_account")
		return
	if kind == "apple":
		if not mochi.text.valid(fields["username"], "email"):
			a.error.label(400, "errors.invalid_account")
			return
		fields.pop("url", None)
	else:
		url = scheme(fields.get("url", ""))
		fields["url"] = url
		if not url.startswith("http://") and not url.startswith("https://") or not mochi.text.valid(url, "url"):
			a.error.label(400, "errors.url_scheme_required")
			return
	added = mochi.account.add(kind, **fields)
	if not added or not added.get("id"):
		a.error.label(502, "errors.calendar_unreachable")
		return
	tried = mochi.account.test(added["id"])
	if not tried or not tried.get("success"):
		mochi.account.remove(added["id"])
		a.error.label(502, "errors.account_failed", message=(tried or {}).get("message", ""))
		return
	account = mochi.account.get(added["id"]) or added
	return {"data": {"account": {"id": account["id"], "type": account["type"], "label": account.get("label", ""), "identifier": account.get("identifier", ""), "granted": account.get("granted", ["calendar"])}}}

def account_error(a, result):
	code = result.get("error", "")
	if code == "unauthorised":
		a.error.label(502, "errors.account_unauthorised")
	elif code == "missing":
		a.error.label(404, "errors.account_not_found")
	else:
		a.error.label(502, "errors.calendar_unreachable")

# The calendars an account's server offers, each with the calendar here that
# already mirrors it.
def action_calendar_remote(a):
	identity = a.user.identity.id
	account = a.input("account", "")
	result = mochi.caldav.calendars(account)
	if result.get("error"):
		account_error(a, result)
		return
	linked = {}
	for row in mochi.db.rows("select id, collection from calendars where identity=? and account=?", identity, account):
		linked[row["collection"]] = row["id"]
	calendars = []
	for remote in result.get("calendars", []):
		calendars.append(dict(remote, linked=linked.get(remote["href"], "")))
	return {"data": {"calendars": calendars}}

# Link a calendar here to a collection on the account's server, and bring
# its events in.
def action_calendar_link(a):
	identity = a.user.identity.id
	calendars_ensure(identity)
	account = a.input("account", "")
	collection = a.input("collection", "").strip()
	if not mochi.account.get(account):
		a.error.label(404, "errors.account_not_found")
		return
	if not collection.startswith("http://") and not collection.startswith("https://") or not mochi.text.valid(collection, "url"):
		a.error.label(400, "errors.url_scheme_required")
		return
	if mochi.db.exists("select id from calendars where identity=? and collection=?", identity, collection):
		a.error.label(400, "errors.calendar_linked")
		return
	colour = colour_input(a, _COLOUR_DEFAULT)
	if colour == None:
		return
	name = a.input("name", "").strip()
	if not name or length(name) > _NAME_MAXIMUM or not mochi.text.valid(name, "name"):
		name = address_name(collection)
	# The server's word on whether this account may write the collection;
	# a server that says nothing is taken at its first refused write.
	readonly = False
	for remote in mochi.caldav.calendars(account).get("calendars", []):
		if remote["href"] == collection and remote.get("readonly"):
			readonly = True
	id = mochi.entity.create("calendar", name, "private")
	calendar_insert(identity, id, mochi.entity.fingerprint(id), "linked", colour, account=account, collection=collection, readonly=readonly)
	row = calendar_get(identity, id)
	# A CalDAV client's check can find the new calendar stale and refresh it
	# already; that sync stands in for this one.
	token = poll_lock(id)
	if token:
		linked_sync(row, True)
		poll_unlock(id, token)
	poll_schedule(id, _LINK_POLL)
	ensure_polls()
	return {"data": {"calendar": calendar_public(calendar_get(identity, id))}}

# === Actions: events ===

def range_input(a):
	start = a.input("start", "")
	finish = a.input("finish", "")
	if not decimal(start) or not decimal(finish) or len(start) > 12 or len(finish) > 12:
		a.error.label(400, "errors.invalid_range")
		return None
	start, finish = int(start), int(finish)
	if finish <= start or finish - start > _RANGE_MAXIMUM:
		a.error.label(400, "errors.invalid_range")
		return None
	return (start, finish)

# The occurrences of every shown calendar in a range, recurrences expanded.
def action_events(a):
	identity = a.user.identity.id
	calendars_ensure(identity)
	span = range_input(a)
	if not span:
		return
	start, finish = span
	# The zone the client resolved "auto" to, so floating times and day
	# boundaries agree with what it draws; else the server's own resolution.
	timezone = a.input("timezone", "")
	if timezone and not mochi.text.valid(timezone, "timezone"):
		timezone = ""
	wanted = [c for c in a.input("calendars", "").split(",") if c]
	out = []
	for calendar in calendars_rows(identity):
		if wanted and calendar["id"] not in wanted and mochi.entity.fingerprint(calendar["id"]) not in wanted:
			continue
		if calendar["kind"] == "birthdays":
			out.extend(birthdays_instances(identity, start, finish, calendar["colour"], calendar["id"]))
			continue
		readonly = calendar_readonly(calendar)
		for row in mochi.db.rows("select id, ics, uid from events where calendar=? and component='VEVENT' and start<? and ( finish>? or finish=0 or recurring=1 )", calendar["id"], finish, start):
			for instance in mochi.ical.instances(row["ics"], start, finish, timezone=timezone):
				instance["event"] = row["id"]
				instance["calendar"] = calendar["id"]
				# The event's own colour when it carries one, else its calendar's.
				instance["colour"] = instance.get("colour") or calendar["colour"]
				instance["readonly"] = readonly
				out.append(instance)
				if len(out) >= _INSTANCES_MAXIMUM:
					return {"data": {"instances": instances_sorted(out), "truncated": True}}
	return {"data": {"instances": instances_sorted(out), "truncated": False}}

# Occurrences in time order, whatever calendar or event they came from.
def instances_sorted(instances):
	return sorted(instances, key=lambda i: (i["start"], i["finish"]))

# The first and last moments any shown calendar has something on, so a list
# that scrolls knows where to stop. A recurrence with neither COUNT nor UNTIL,
# and the birthdays calendar, go on for ever: "endless" says so and "last" is
# then the last bounded moment.
def action_events_bounds(a):
	identity = a.user.identity.id
	calendars_ensure(identity)
	wanted = [c for c in a.input("calendars", "").split(",") if c]
	first = 0
	last = 0
	endless = False
	for calendar in calendars_rows(identity):
		if wanted and calendar["id"] not in wanted and mochi.entity.fingerprint(calendar["id"]) not in wanted:
			continue
		if calendar["kind"] == "birthdays":
			today = birthday_today()
			for contact in birthdays_contacts(identity):
				upcoming = birthday_next(contact, today)
				if upcoming and (first == 0 or upcoming < first):
					first = upcoming
				endless = True
			continue
		row = mochi.db.row("select min(case when start>0 then start end) as first, max(ends) as last, min(ends) as least from events where calendar=? and component='VEVENT'", calendar["id"])
		if row and row["first"] and (first == 0 or row["first"] < first):
			first = row["first"]
		if row and row["last"] and row["last"] > last:
			last = row["last"]
		if row and row["least"] == -1:
			endless = True
	return {"data": {"first": first, "last": last, "endless": endless}}

def action_event_get(a):
	identity = a.user.identity.id
	row = event_get(identity, a.input("event", ""))
	if not row:
		a.error.label(404, "errors.event_not_found")
		return
	return {"data": {"event": event_full(row)}}

def action_events_batch(a):
	identity = a.user.identity.id
	body = body_json(a)
	ids = body.get("events") if body else None
	if not islist(ids) or len(ids) > 500:
		a.error.label(400, "errors.invalid_request")
		return
	out = []
	for id in ids:
		row = event_get(identity, id) if type(id) == "string" else None
		if row:
			out.append(event_full(row))
	return {"data": {"events": out}}

def event_error(a, code):
	if code == "too_large":
		a.error.label(400, "errors.event_too_large")
	elif code == "duplicate":
		a.error.label(409, "errors.event_duplicate")
	elif code == "conflict":
		a.error.label(412, "errors.event_changed")
	elif code == "readonly":
		a.error.label(400, "errors.calendar_readonly")
	elif code == "unauthorised" or code.startswith("unauthorised:"):
		a.error.label(502, "errors.account_unauthorised")
	elif code == "invalid":
		a.error.label(400, "errors.invalid_event")
	else:
		a.error.label(502, "errors.calendar_unreachable")

def action_event_create(a):
	identity = a.user.identity.id
	calendars_ensure(identity)
	body = body_json(a)
	if body == None:
		a.error.label(400, "errors.invalid_event")
		return
	calendar = calendar_get(identity, body.get("calendar", "")) if body.get("calendar") else calendar_preferred(identity, a.user)
	if not calendar:
		a.error.label(404, "errors.calendar_not_found")
		return
	if calendar_readonly(calendar):
		a.error.label(400, "errors.calendar_readonly")
		return
	slug = body.get("slug", "")
	if slug:
		if not slug_valid(slug):
			a.error.label(400, "errors.invalid_event")
			return
		existing = event_by_slug(calendar["id"], slug)
		if existing:
			return {"data": {"event": event_full(existing)}}
	uid = mochi.uid() + "@mochi"
	ics = event_text(body.get("components"), uid)
	if ics == None:
		a.error.label(400, "errors.invalid_event")
		return
	row = event_write(identity, calendar["id"], slug, ics)
	if type(row) == "string":
		event_error(a, row)
		return
	return {"data": {"event": event_full(row)}}

def action_event_update(a):
	identity = a.user.identity.id
	body = body_json(a)
	if body == None:
		a.error.label(400, "errors.invalid_event")
		return
	row = event_get(identity, body.get("event", "") if type(body.get("event")) == "string" else "")
	if not row:
		a.error.label(404, "errors.event_not_found")
		return
	expected = body.get("etag", "")
	if expected and expected != row["etag"]:
		a.error.label(412, "errors.event_changed")
		return
	calendar = mochi.db.row("select * from calendars where id=?", row["calendar"])
	if not calendar or calendar_readonly(calendar):
		a.error.label(400, "errors.calendar_readonly")
		return
	target = calendar
	if body.get("calendar") and body.get("calendar") != row["calendar"]:
		target = calendar_get(identity, body.get("calendar"))
		if not target:
			a.error.label(404, "errors.calendar_not_found")
			return
		if calendar_readonly(target):
			a.error.label(400, "errors.calendar_readonly")
			return
	ics = row["ics"]
	if "components" in body:
		ics = event_text(body.get("components"), row["uid"] or (mochi.uid() + "@mochi"))
		if ics == None:
			a.error.label(400, "errors.invalid_event")
			return
	if target["id"] != row["calendar"]:
		slug = row["slug"]
		if event_by_slug(target["id"], slug):
			slug = row["id"]
			if event_by_slug(target["id"], slug):
				a.error.label(409, "errors.event_duplicate")
				return
		if row["uid"] and mochi.db.exists("select id from events where calendar=? and uid=? and id!=?", target["id"], row["uid"], row["id"]):
			a.error.label(409, "errors.event_duplicate")
			return
		if calendar["kind"] == "linked" and row["href"]:
			result = mochi.caldav.delete(calendar["account"], row["href"], row["remote"])
			if linked_forbidden(result):
				event_error(a, linked_refused(calendar, row, False))
				return
			if result.get("error") and result["error"] != "missing":
				event_error(a, result["error"])
				return
		mochi.db.execute("update events set calendar=?, slug=?, href='', remote='', dirty=0, updated=? where id=? and identity=?", target["id"], slug, mochi.time.now(), row["id"], identity)
		calendar_touch(row["calendar"], row["id"], 1)
		row = event_get(identity, row["id"])
	written = event_write(identity, target["id"], row["slug"], ics, row)
	if type(written) == "string":
		event_error(a, written)
		return
	return {"data": {"event": event_full(written)}}

# series_count(ics, start) -> int: how many occurrences the series' rule
# generates before the one listed at `start`, which a COUNT carried onto the
# series' second half must be shortened by. It counts as COUNT does: DTSTART
# first, dates EXDATE removes included, RDATE's extra dates and the changes of
# single occurrences left out. A changed occurrence listed at `start` counts
# from the date it replaces.
def series_count(ics, start):
	tree = mochi.ical.parse(ics) or {}
	components = [c for c in tree.get("components", []) if type(c) == "dict"]
	zones = [c for c in components if c.get("name") == "VTIMEZONE"]
	master = None
	point = start
	for c in components:
		if c.get("name") != "VEVENT":
			continue
		if not property_value(c, "RECURRENCE-ID"):
			master = master or c
		elif instant(c, "DTSTART", zones) == start:
			point = instant(c, "RECURRENCE-ID", zones)
	if not master or point == None:
		return 0
	bare = dict(master, properties=[p for p in master.get("properties", []) if type(p) == "dict" and p.get("name") not in ("EXDATE", "RDATE")])
	text = mochi.ical.format(calendar_wrap([bare], zones))
	return len(mochi.ical.instances(text, 0, point)) if text else 0

# instant(component, name, zones) -> int or None: the moment a date property
# of the component names, read as the listing reads an occurrence's start.
def instant(component, name, zones):
	for p in component.get("properties", []):
		if type(p) == "dict" and p.get("name") == name:
			single = {"name": "VEVENT", "properties": [
				{"name": "UID", "params": {}, "value": "instant"},
				{"name": "DTSTAMP", "params": {}, "value": "19700101T000000Z"},
				{"name": "DTSTART", "params": p.get("params") or {}, "value": p.get("value", "")},
			], "components": []}
			text = mochi.ical.format(calendar_wrap([single], zones))
			got = mochi.ical.instances(text) if text else []
			return got[0]["start"] if got else None
	return None

# rule_shortened(components, count) -> list: the components with the master's
# RRULE COUNT reduced by `count`, never below one, or as given when its rule
# has no COUNT.
def rule_shortened(components, count):
	out = []
	for component in components:
		if type(component) != "dict" or component.get("name") != "VEVENT" or property_value(component, "RECURRENCE-ID"):
			out.append(component)
			continue
		properties = []
		for p in component.get("properties", []):
			if type(p) == "dict" and p.get("name") == "RRULE" and type(p.get("value")) == "string":
				parts = []
				for part in p["value"].split(";"):
					if part.upper().startswith("COUNT="):
						remaining = part[6:]
						if decimal(remaining):
							part = "COUNT=" + str(max(1, int(remaining) - count))
					parts.append(part)
				p = dict(p, value=";".join(parts))
			properties.append(p)
		out.append(dict(component, properties=properties))
	return out

# The occurrence at `start` and every one after it become a new event: the
# old one is rewritten to end before it, from the components the client
# sends, and the new one is created from the rest, in one step so the series
# is never left with both halves or neither. With `copy` the old one is left
# as it is, and the new event is a copy of the series from that occurrence.
def action_event_split(a):
	identity = a.user.identity.id
	body = body_json(a)
	if body == None:
		a.error.label(400, "errors.invalid_event")
		return
	row = event_get(identity, body.get("event", "") if type(body.get("event")) == "string" else "")
	if not row:
		a.error.label(404, "errors.event_not_found")
		return
	expected = body.get("etag", "")
	if expected and expected != row["etag"]:
		a.error.label(412, "errors.event_changed")
		return
	calendar = mochi.db.row("select * from calendars where id=?", row["calendar"])
	if not calendar or calendar_readonly(calendar):
		a.error.label(400, "errors.calendar_readonly")
		return
	target = calendar
	if body.get("calendar") and body.get("calendar") != row["calendar"]:
		target = calendar_get(identity, body.get("calendar"))
		if not target:
			a.error.label(404, "errors.calendar_not_found")
			return
		if calendar_readonly(target):
			a.error.label(400, "errors.calendar_readonly")
			return
	start = body.get("start")
	if type(start) != "int" or start <= 0 or not islist(body.get("following")):
		a.error.label(400, "errors.invalid_event")
		return
	copy = body.get("copy") == True
	before = None if copy else event_text(body.get("components"), row["uid"] or (mochi.uid() + "@mochi"))
	if before == None and not copy:
		a.error.label(400, "errors.invalid_event")
		return
	following = rule_shortened(body.get("following"), series_count(row["ics"], start))
	after = event_text(following, mochi.uid() + "@mochi")
	if after == None:
		a.error.label(400, "errors.invalid_event")
		return
	# The new half first: should it fail, the old event is still whole.
	created = event_write(identity, target["id"], "", after)
	if type(created) == "string":
		event_error(a, created)
		return
	if copy:
		return {"data": {"event": event_full(row), "following": event_full(created)}}
	written = event_write(identity, row["calendar"], row["slug"], before, row)
	if type(written) == "string":
		event_delete(identity, created)
		event_error(a, written)
		return
	return {"data": {"event": event_full(written), "following": event_full(created)}}

def action_event_delete(a):
	identity = a.user.identity.id
	row = event_get(identity, a.input("event", ""))
	if not row:
		a.error.label(404, "errors.event_not_found")
		return
	expected = a.input("etag", "")
	if expected and expected != row["etag"]:
		a.error.label(412, "errors.event_changed")
		return
	calendar = mochi.db.row("select * from calendars where id=?", row["calendar"])
	if calendar and calendar_readonly(calendar):
		a.error.label(400, "errors.calendar_readonly")
		return
	code = event_delete(identity, row)
	if code:
		event_error(a, code)
		return
	return {"data": {}}

def action_events_changes(a):
	identity = a.user.identity.id
	since = a.input("since", "0") or "0"
	if not decimal(since) or len(since) > 18:
		a.error.label(400, "errors.invalid_since")
		return
	since = int(since)
	latest = mochi.db.row("select max(id) as id from changes")
	version = latest["id"] if latest and latest["id"] else 0
	floor = mochi.db.row("select change from pruned where identity=?", identity)
	if since == 0 or (floor and since < floor["change"]):
		return {"data": {"version": version, "reset": True, "changed": [row["id"] for row in mochi.db.rows("select id from events where identity=?", identity)], "deleted": []}}
	changed = []
	deleted = []
	for row in mochi.db.rows("select event, deleted from changes where identity=? and id>? order by id", identity, since):
		if row["deleted"] == 1:
			deleted.append(row["event"])
		else:
			changed.append(row["event"])
	return {"data": {"version": max(version, since), "reset": False, "changed": changed, "deleted": deleted}}

# === Actions: ICS links ===
# The link others subscribe to: the calendar's fingerprint URL plus a token
# bound to this action and this calendar, kept as a hash only.

def action_link(a):
	identity = a.user.identity.id
	row = calendar_get(identity, a.input("calendar", ""))
	if not row:
		a.error.label(404, "errors.calendar_not_found")
		return
	# mochi.token.create refuses without tokens/create; answered here so the
	# refusal is a clean 403, and before an existing link could be revoked.
	if not mochi.permission.check("tokens/create"):
		a.error.label(403, "errors.not_allowed")
		return
	regenerate = a.input("regenerate", "") == "1"
	existing = mochi.db.row("select hash from links where calendar=?", row["id"])
	if existing and not regenerate:
		return {"data": {"exists": True}}
	if existing:
		mochi.token.delete(existing["hash"])
		mochi.db.execute("delete from links where calendar=?", row["id"])
	token = mochi.token.create("ics", ["ics"], 0, ":calendar/calendar.ics", row["id"])
	if not token:
		a.error.label(500, "errors.failed_to_create_token")
		return
	mochi.db.execute("insert into links ( hash, calendar, created ) values ( ?, ?, ? )", mochi.crypto.hash.sha256(token), row["id"], mochi.time.now())
	return {"data": {"token": token, "path": "/calendars/" + mochi.entity.fingerprint(row["id"]) + "/calendar.ics"}}

def action_link_revoke(a):
	identity = a.user.identity.id
	row = calendar_get(identity, a.input("calendar", ""))
	if not row:
		a.error.label(404, "errors.calendar_not_found")
		return
	links = mochi.db.rows("select hash from links where calendar=?", row["id"])
	for link in links:
		mochi.token.delete(link["hash"])
	mochi.db.execute("delete from links where calendar=?", row["id"])
	return {"data": {"revoked": len(links) > 0}}

# text_escape(s) -> string: s written as an iCalendar text value, as
# mochi.ical.format writes one: backslash, semicolon and comma escaped, and
# each line break as \n.
def text_escape(s):
	s = s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
	return s.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")

# calendar_text(row) -> string: the whole calendar as one iCalendar text.
def calendar_text(row):
	name = mochi.entity.name(row["id"]) or ""
	components = []
	timezones = {}
	if row["kind"] == "birthdays":
		for contact in birthdays_contacts(row["identity"]):
			tree = mochi.ical.parse(birthday_object(contact)["ics"])
			if tree:
				components.extend(tree.get("components", []))
	else:
		for event in mochi.db.rows("select ics from events where calendar=?", row["id"]):
			tree = mochi.ical.parse(event["ics"])
			if not tree:
				continue
			for c in tree.get("components", []):
				if type(c) != "dict":
					continue
				if c.get("name") == "VTIMEZONE":
					timezones[property_value(c, "TZID")] = c
				else:
					components.append(c)
	calendar = calendar_wrap(components, list(timezones.values()) + timezones_named(components, timezones))
	if name:
		calendar["properties"].append({"name": "X-WR-CALNAME", "params": {}, "value": name})
	if not components:
		# An empty VCALENDAR is not valid; a placeholder keeps the link usable.
		return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:" + _PRODID + "\r\nX-WR-CALNAME:" + text_escape(name) + "\r\nEND:VCALENDAR\r\n"
	text = mochi.ical.format(calendar)
	# A description stored as HTML, as a Google calendar writes it, goes out
	# as its text with the HTML beside it, since other clients read
	# DESCRIPTION as plain text. A core without the call serves it as stored.
	if hasattr(mochi.ical, "plain"):
		text = mochi.ical.plain(text)
	return text

# Public, token-gated. An anonymous request runs as the calendar's owner, so
# the token is the only gate and nothing falls through to ownership.
def action_ics(a):
	calendar = a.input("calendar", "")
	row = None
	for candidate in mochi.db.rows("select * from calendars"):
		if candidate["id"] == calendar or mochi.entity.fingerprint(candidate["id"]) == calendar:
			row = candidate
	if not row:
		a.error.label(404, "errors.calendar_not_found")
		return
	token = a.input("token", "")
	if not token or not mochi.db.exists("select hash from links where calendar=? and hash=?", row["id"], mochi.crypto.hash.sha256(token)):
		a.error.label(403, "errors.access_denied")
		return
	a.header("Content-Type", "text/calendar; charset=utf-8")
	a.header("Cache-Control", "private, max-age=300")
	a.print(calendar_text(row))

# === Actions: import and export ===
# An import uploads an iCalendar file once and writes its objects into one
# calendar in rounds the client repeats, each stopping after _IMPORT_BATCH
# objects or _IMPORT_ROUND seconds, so a years-long export never meets the
# Starlark time limit and the client can show progress. The file
# waits between rounds under imports/ in the app's storage and is removed after
# the last round; one an abandoned import left is removed by a later import.

_IMPORT_BATCH = 200
_IMPORT_ROUND = 20
_IMPORT_STALE = 86400

def import_sweep():
	if not mochi.file.exists("imports"):
		return
	for entry in mochi.file.list("imports") or []:
		name = entry.get("name", "") if type(entry) == "dict" else entry
		if not name:
			continue
		age = mochi.file.age("imports/" + name)
		if age != None and age > _IMPORT_STALE:
			mochi.file.delete("imports/" + name)

# Each round answers what it wrote: an object whose uid the calendar already
# holds is skipped, so importing a file twice adds nothing the second time, an
# object with no uid included (see ics_groups).
def action_calendar_import(a):
	identity = a.user.identity.id
	row = calendar_get(identity, a.input("calendar", ""))
	if not row:
		a.error.label(404, "errors.calendar_not_found")
		return
	if calendar_readonly(row):
		a.error.label(400, "errors.calendar_readonly")
		return
	offset = a.input("offset", "0")
	if not decimal(offset) or len(offset) > 9:
		a.error.label(400, "errors.invalid_request")
		return
	offset = int(offset)
	staged = a.input("import", "")
	if staged:
		if not slug_valid(staged) or not mochi.file.exists("imports/" + staged):
			a.error.label(404, "errors.import_not_found")
			return
	else:
		if not a.files("file"):
			a.error.label(400, "errors.import_file_required")
			return
		import_sweep()
		staged = mochi.uid()
		a.upload("file", "imports/" + staged)
	path = "imports/" + staged
	text = str(mochi.file.read(path) or "")
	if len(text) > _SUBSCRIPTION_BYTES_MAXIMUM:
		mochi.file.delete(path)
		a.error.label(400, "errors.import_too_large")
		return
	tree = mochi.ical.parse(text) if text else None
	if not tree:
		mochi.file.delete(path)
		a.error.label(400, "errors.import_invalid")
		return
	groups, timezones = ics_groups(tree)
	if offset > len(groups):
		a.error.label(400, "errors.invalid_request")
		return
	started = mochi.time.now()
	counts = {"imported": 0, "skipped": 0, "failed": 0}
	reached = offset
	for index in range(offset, len(groups)):
		if index - offset >= _IMPORT_BATCH or (index > offset and mochi.time.now() - started >= _IMPORT_ROUND):
			break
		uid, components = groups[index]
		ics = group_text(components, timezones)
		written = event_write(identity, row["id"], "", ics) if ics else "invalid"
		if type(written) == "dict":
			counts["imported"] += 1
		elif written == "duplicate":
			counts["skipped"] += 1
		else:
			counts["failed"] += 1
		reached = index + 1
	finished = reached >= len(groups)
	if finished:
		mochi.file.delete(path)
	return {"data": {"import": staged, "offset": reached, "total": len(groups), "imported": counts["imported"], "skipped": counts["skipped"], "failed": counts["failed"], "finished": finished}}

# The whole calendar as one iCalendar file, any calendar the user has: their
# own, a linked or subscribed one, or the birthdays calendar.
def action_calendar_export(a):
	identity = a.user.identity.id
	row = calendar_get(identity, a.input("calendar", ""))
	if not row:
		a.error.label(404, "errors.calendar_not_found")
		return
	a.header("Content-Type", "text/calendar; charset=utf-8")
	a.header("Content-Disposition", "attachment; filename=\"calendar.ics\"")
	a.print(calendar_text(row))

# === Actions: preferences ===

# "zones" shows each event at its own wall-clock time, each end in the zone it
# was written in, rather than converted into the user's zone. "calendar" is
# the calendar a new event goes in, one the user can write to; empty means the
# built-in default calendar. "allday" is where a day's all-day events go among
# its timed ones in the month and multiweek views, "first" or "last".
_PREFERENCES = {"hours": {"start": 8, "finish": 17}, "days": [1, 2, 3, 4, 5], "multiweek": {"weeks": 4, "previous": 0}, "duration": 60, "reminder": _REMINDER_DEFAULT, "view": "month", "zones": False, "calendar": "", "allday": "first"}

def preferences_read(a):
	return preferences_load(a.user)

# The preferences of a user object, a request's or a schedule's.
def preferences_load(user):
	stored = json.decode(user.preference.get("calendars") or "{}", None)
	out = {}
	for key in _PREFERENCES:
		out[key] = stored.get(key, _PREFERENCES[key]) if type(stored) == "dict" else _PREFERENCES[key]
	return out

# calendar_preferred(identity, user): the calendar a new event goes in when
# nothing names one: the user's chosen calendar while it exists and can be
# written, else the built-in default calendar, which cannot be deleted.
def calendar_preferred(identity, user):
	chosen = preferences_load(user)["calendar"]
	row = calendar_get(identity, chosen) if type(chosen) == "string" and chosen else None
	if row and not calendar_readonly(row):
		return row
	return calendar_by_slug(identity, "default")

def action_preferences_get(a):
	return {"data": {"preferences": preferences_read(a)}}

def bounded(value, low, high, fallback):
	if type(value) != "int" or value < low or value > high:
		return fallback
	return value

def action_preferences_set(a):
	body = body_json(a)
	if body == None:
		a.error.label(400, "errors.invalid_preferences")
		return
	current = preferences_read(a)
	hours = body.get("hours", current["hours"])
	if type(hours) != "dict":
		hours = current["hours"]
	start = bounded(hours.get("start"), 0, 23, current["hours"]["start"])
	finish = bounded(hours.get("finish"), 1, 24, current["hours"]["finish"])
	if finish <= start:
		a.error.label(400, "errors.invalid_preferences")
		return
	days = body.get("days", current["days"])
	if not islist(days) or [d for d in days if type(d) != "int" or d < 0 or d > 6]:
		days = current["days"]
	multiweek = body.get("multiweek", current["multiweek"])
	if type(multiweek) != "dict":
		multiweek = current["multiweek"]
	view = body.get("view", current["view"])
	if view not in ("day", "week", "multiweek", "month", "list"):
		view = current["view"]
	zones = body.get("zones", current["zones"])
	if type(zones) != "bool":
		zones = current["zones"]
	allday = body.get("allday", current["allday"])
	if allday not in ("first", "last"):
		allday = current["allday"]
	# A calendar named here must be one the user can write to; one kept from
	# before that has since gone, or become read-only, is let go.
	calendar = body.get("calendar", current["calendar"])
	if type(calendar) != "string":
		calendar = current["calendar"]
	if calendar:
		row = calendar_get(a.user.identity.id, calendar)
		if not row or calendar_readonly(row):
			if "calendar" in body:
				a.error.label(400, "errors.invalid_preferences")
				return
			calendar = ""
		else:
			calendar = row["id"]
	out = {
		"hours": {"start": start, "finish": finish},
		"days": sorted(set(days)) if days else [],
		"multiweek": {"weeks": bounded(multiweek.get("weeks"), 2, 8, current["multiweek"]["weeks"]), "previous": bounded(multiweek.get("previous"), 0, 2, current["multiweek"]["previous"])},
		"duration": bounded(body.get("duration", current["duration"]), 0, 1440, current["duration"]),
		"reminder": bounded(body.get("reminder", current["reminder"]), -1, 10080, current["reminder"]),
		"view": view,
		"zones": zones,
		"calendar": calendar,
		"allday": allday,
	}
	a.user.preference.set("calendars", json.encode(out))
	return {"data": {"preferences": out}}

# === Actions: device tokens ===
# The credential a CalDAV client holds: the dav scope, bound to the caldav
# route, one per device, never expiring because it is bound.

def token_name_input(a):
	name = a.input("name", "").strip()
	if not name:
		a.error.label(400, "errors.name_is_required")
		return None
	if length(name) > 100:
		a.error.label(400, "errors.token_name_is_too_long_max_100_characters")
		return None
	return name

def action_token_create(a):
	name = token_name_input(a)
	if name == None:
		return
	if not mochi.permission.check("tokens/create"):
		a.error.label(403, "errors.not_allowed")
		return
	token = mochi.token.create(name, ["dav"], 0, "caldav/*path", "")
	if not token:
		a.error.label(500, "errors.failed_to_create_token")
		return
	# The engine ignores the username; the account's address is what a
	# client asks for and what the user expects to type.
	return {"data": {"token": token, "username": a.user.username}}

# Only the device credentials: the app's ICS link tokens are bound to the
# calendar address and are revoked from the calendar, not from the device list.
def action_token_list(a):
	# Every device credential the user holds, whichever app minted it: one
	# password serves contacts and calendars, so both apps list the same
	# devices. The dav scope leaves the app's ICS link tokens out.
	# The username rides along so the connect dialog can show it before any
	# device is created.
	return {"data": {"tokens": mochi.token.list("dav") or [], "username": a.user.username}}

def action_token_delete(a):
	hash = a.input("hash", "").strip()
	if not hash or len(hash) > 128:
		a.error.label(400, "errors.invalid_token_hash")
		return
	return {"data": {"ok": mochi.token.delete(hash)}}

# === CalDAV ===
# Core serves the caldav/*path route with its DAV engine and calls these as
# the server for the authenticated identity (core/server/dav.go). A collection
# is a calendar named by its slug, an object an event named by its slug, and
# the object travels as iCalendar text. Subscriptions and birthdays are
# read-only collections.

def dav_caller(context):
	return type(context) == "dict" and context.get("_server") == True

def dav_collection(row):
	return {"slug": row["slug"], "name": mochi.entity.name(row["id"]) or "", "description": "", "readonly": calendar_readonly(row), "components": ["VEVENT"], "version": row["version"]}

def function_dav_collections(context, identity, collection=None):
	if not dav_caller(context) or not identity:
		return []
	calendars_ensure(identity)
	if collection != None:
		row = calendar_by_slug(identity, collection)
		rows = [row] if row else []
	else:
		rows = calendars_rows(identity)
	# A client checking a linked calendar gets it synced in the background,
	# so another server's change reaches it on its next check rather than
	# after the scheduled poll.
	for row in rows:
		if linked_stale(row):
			mochi.schedule.after("schedule_calendars_refresh", {"calendar": row["id"]}, 0)
	return [dav_collection(row) for row in rows]

def function_dav_collection_create(context, identity, collection, name="", description=""):
	if not dav_caller(context):
		return {"error": "forbidden"}
	if not identity or not slug_valid(collection):
		return {"error": "invalid"}
	if calendar_by_slug(identity, collection):
		return {"error": "exists"}
	calendars_ensure(identity)
	label = name.strip() if type(name) == "string" else ""
	if not label or length(label) > _NAME_MAXIMUM or not mochi.text.valid(label, "name"):
		label = collection
	id = mochi.entity.create("calendar", label, "private")
	# Two MKCALENDARs for one slug at once both pass the check above. The
	# unique index decides; the loser drops the entity it made and answers as
	# a sequential duplicate would, rather than failing on the constraint.
	calendar_insert(identity, id, collection, "own", _COLOUR_DEFAULT, ignore=True)
	row = calendar_by_slug(identity, collection)
	if row["id"] != id:
		mochi.entity.delete(id)
		return {"error": "exists"}
	return {"slug": collection}

def function_dav_collection_delete(context, identity, collection):
	if not dav_caller(context):
		return {"error": "forbidden"}
	row = calendar_by_slug(identity, collection) if identity else None
	if not row:
		return {"error": "not_found"}
	if row["slug"] in ("default", "birthdays"):
		return {"error": "forbidden"}
	calendar_delete(identity, row)
	return {}

def dav_object(row):
	return {"name": row["slug"], "etag": row["etag"], "updated": row["updated"], "ics": row["ics"]}

def function_dav_objects(context, identity, collection, names=None, start=None, finish=None, data=True, offset=None, limit=None):
	if not dav_caller(context):
		return {"error": "forbidden"}
	calendar = calendar_by_slug(identity, collection) if identity else None
	if not calendar:
		return {"error": "not_found"}
	if calendar["kind"] == "birthdays":
		objects = [birthday_object(contact) for contact in birthdays_contacts(identity)]
		if names != None:
			wanted = {n: True for n in names}
			objects = [o for o in objects if o["name"] in wanted]
		if not data:
			return [{"name": o["name"], "etag": o["etag"], "updated": 0} for o in objects]
		return objects
	if not data:
		rows = mochi.db.rows("select slug, etag, updated from events where calendar=? order by created, id", calendar["id"])
		return [{"name": row["slug"], "etag": row["etag"], "updated": row["updated"]} for row in rows]
	if names != None:
		wanted = [n for n in names if slug_valid(n)]
		rows = []
		for i in range(0, len(wanted), 200):
			chunk = wanted[i:i + 200]
			rows.extend(mochi.db.rows("select * from events where calendar=? and slug in (" + ", ".join(["?"] * len(chunk)) + ")", calendar["id"], chunk))
	elif start != None or finish != None:
		conditions = ["calendar=?"]
		values = [calendar["id"]]
		if finish != None:
			conditions.append("start<?")
			values.append(finish)
		if start != None:
			conditions.append("( finish>? or finish=0 or recurring=1 )")
			values.append(start)
		rows = mochi.db.rows("select * from events where " + " and ".join(conditions) + " order by start", *values)
	elif offset != None:
		rows = mochi.db.rows("select * from events where calendar=? order by created, id limit ? offset ?", calendar["id"], limit or 100, offset)
	else:
		rows = mochi.db.rows("select * from events where calendar=? order by created, id", calendar["id"])
	return [dav_object(row) for row in rows]

def function_dav_put(context, identity, collection, name, ics, match="", absent=False, uid="", component="", summary="", start=0, finish=0, allday=False, recurring=False):
	if not dav_caller(context):
		return {"error": "forbidden"}
	calendar = calendar_by_slug(identity, collection) if identity else None
	if not calendar:
		return {"error": "not_found"}
	if calendar_readonly(calendar):
		return {"error": "readonly"}
	if not slug_valid(name):
		return {"error": "invalid"}
	row = event_by_slug(calendar["id"], name)
	if absent and row:
		return {"error": "conflict"}
	if match == "*" and not row:
		return {"error": "conflict"}
	if match and match != "*" and (not row or row["etag"] != match):
		return {"error": "conflict"}
	written = event_write(identity, calendar["id"], name, ics, row)
	if type(written) == "string":
		return {"error": written}
	return {"name": name, "etag": written["etag"], "updated": written["updated"]}

def function_dav_delete(context, identity, collection, name, match="", absent=False):
	if not dav_caller(context):
		return {"error": "forbidden"}
	calendar = calendar_by_slug(identity, collection) if identity else None
	if not calendar:
		return {"error": "not_found"}
	if calendar_readonly(calendar):
		return {"error": "readonly"}
	row = event_by_slug(calendar["id"], name)
	if not row:
		return {"error": "not_found"}
	if absent or (match and match != "*" and match != row["etag"]):
		return {"error": "conflict"}
	code = event_delete(identity, row)
	if code == "conflict":
		return {"error": "conflict"}
	if code:
		return {"error": "unreachable"}
	return {}
