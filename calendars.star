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
# Three kinds of calendar: own (the user's events), subscription (an external
# ICS URL, polled, read-only) and birthdays (derived from contacts, read-only,
# nothing stored).

_PRODID = "-//Mochisoft//Mochi Calendars//EN"

# Bounds. An event's text; events per identity; events one subscription may
# hold; the bytes one subscription fetch may carry; components in one object.
_ICS_MAXIMUM = 1048576
_EVENTS_MAXIMUM = 20000
_SUBSCRIPTION_EVENTS_MAXIMUM = 5000
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

# Reminders are scheduled per occurrence this far ahead; a fired reminder and
# the calendar listing top the window up.
_REMINDER_WINDOW = 30 * 86400
_REMINDER_TOPUP = 20
_REMINDER_DEFAULT = 15

_COLOUR_DEFAULT = "#60a5fa"

# A change in the log is kept this long after the event is deleted.
_TOMBSTONE_RETENTION = 7776000

def database_upgrade(version):
	pass

def database_create():
	mochi.db.execute("create table if not exists calendars ( id text not null primary key, identity text not null, slug text not null default '', kind text not null default 'own', colour text not null default '', url text not null default '', etag text not null default '', modified text not null default '', interval integer not null default 3600, next integer not null default 0, fetched integer not null default 0, failure text not null default '', version integer not null default 0, created integer not null default 0, updated integer not null default 0 )")
	mochi.db.execute("create index if not exists calendars_identity on calendars( identity )")
	mochi.db.execute("create unique index if not exists calendars_identity_slug on calendars( identity, slug )")
	# ics holds the object's iCalendar text; the rest are read from it when it
	# is written, for listing and the CalDAV time-range prefilter. A recurring
	# event's finish is 0: open-ended.
	mochi.db.execute("create table if not exists events ( id text not null primary key, calendar text not null, identity text not null, slug text not null default '', uid text not null default '', etag text not null default '', ics text not null default '', component text not null default 'VEVENT', summary text not null default '', start integer not null default 0, finish integer not null default 0, allday integer not null default 0, recurring integer not null default 0, created integer not null default 0, updated integer not null default 0 )")
	mochi.db.execute("create index if not exists events_calendar_start on events( calendar, start )")
	mochi.db.execute("create unique index if not exists events_calendar_slug on events( calendar, slug )")
	mochi.db.execute("create unique index if not exists events_calendar_uid on events( calendar, uid ) where uid != ''")
	# Every event write, latest per event, for -/events/changes; pruned holds
	# how far deletions have been forgotten.
	mochi.db.execute("create table if not exists changes ( id integer primary key autoincrement, identity text not null, calendar text not null, event text not null, deleted integer not null default 0, created integer not null default 0 )")
	mochi.db.execute("create index if not exists changes_identity on changes( identity, id )")
	mochi.db.execute("create table if not exists pruned ( identity text not null primary key, change integer not null default 0 )")
	# The token behind a calendar's ICS link, hash only: the link cannot be
	# shown again, only replaced.
	mochi.db.execute("create table if not exists links ( hash text not null primary key, calendar text not null, created integer not null default 0 )")
	mochi.db.execute("create unique index if not exists links_calendar on links( calendar )")
	# Reminders scheduled per occurrence, so a changed event can cancel its own.
	mochi.db.execute("create table if not exists reminders ( event text not null, instance integer not null, schedule integer not null default 0, primary key ( event, instance ) )")
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

def name_input(a, key="name"):
	name = a.input(key, "").strip()
	if not name:
		a.error.label(400, "errors.name_is_required")
		return None
	if len(name) > _NAME_MAXIMUM or not mochi.text.valid(name, "name"):
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
		if c.isdigit():
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
def calendar_insert(identity, id, slug, kind, colour, url="", ignore=False):
	now = mochi.time.now()
	mochi.db.execute("insert" + (" or ignore" if ignore else "") + " into calendars ( id, identity, slug, kind, colour, url, interval, next, created, updated ) values ( ?, ?, ?, ?, ?, ?, ?, 0, ?, ? )",
		id, identity, slug, kind, colour, url, _POLL_BASE, now, now)

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

def calendar_readonly(row):
	return row["kind"] != "own"

def calendar_public(row):
	return {
		"id": row["id"],
		"fingerprint": mochi.entity.fingerprint(row["id"]),
		"slug": row["slug"],
		"name": mochi.entity.name(row["id"]) or "",
		"colour": row["colour"],
		"kind": row["kind"],
		"url": row["url"],
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

def changes_prune(identity):
	old = mochi.db.row("select max(id) as id from changes where identity=? and deleted=1 and created<?", identity, mochi.time.now() - _TOMBSTONE_RETENTION)
	if not old or not old["id"]:
		return
	mochi.db.execute("delete from changes where identity=? and deleted=1 and id<=?", identity, old["id"])
	mochi.db.execute("insert into pruned ( identity, change ) values ( ?, ? ) on conflict( identity ) do update set change=max( change, excluded.change )", identity, old["id"])

def calendar_delete(identity, row):
	for event in mochi.db.rows("select * from events where calendar=?", row["id"]):
		event_delete(identity, event)
	for link in mochi.db.rows("select hash from links where calendar=?", row["id"]):
		mochi.token.delete(link["hash"])
	mochi.db.execute("delete from links where calendar=?", row["id"])
	mochi.db.execute("delete from polls where calendar=?", row["id"])
	if row["kind"] == "subscription":
		for se in mochi.schedule.list():
			if se.event == "schedule_calendars_poll" and se.data.get("calendar", "") == row["id"]:
				se.cancel()
	mochi.db.execute("delete from calendars where id=? and identity=?", row["id"], identity)
	mochi.entity.delete(row["id"])

# === Events ===

def event_get(identity, id):
	if not id or type(id) != "string" or len(id) > 64:
		return None
	return mochi.db.row("select * from events where identity=? and id=?", identity, id)

def event_by_slug(calendar, slug):
	if not slug_valid(slug):
		return None
	return mochi.db.row("select * from events where calendar=? and slug=?", calendar, slug)

def events_full(identity):
	row = mochi.db.row("select count(*) as count from events where identity=?", identity)
	return row != None and row["count"] >= _EVENTS_MAXIMUM

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

def event_full(row):
	out = event_public(row)
	out["ics"] = row["ics"]
	tree = mochi.ical.parse(row["ics"])
	out["components"] = [c for c in tree.get("components", []) if type(c) == "dict" and c.get("name") != "VTIMEZONE"] if tree else []
	return out

# event_write(identity, calendar, slug, ics, row=None) -> row or string: store
# an object's text, reading its columns from it. Answers an error code when
# the text is not a calendar object or another object holds its uid.
def event_write(identity, calendar, slug, ics, row=None):
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
	if row:
		mochi.db.execute("update events set uid=?, etag=?, ics=?, component=?, summary=?, start=?, finish=?, allday=?, recurring=?, updated=? where id=?",
			uid, etag, ics, summary["component"], summary.get("summary", ""), summary.get("start", 0), summary.get("finish", 0), 1 if summary.get("allday") else 0, 1 if summary.get("recurring") else 0, now, row["id"])
		id = row["id"]
	else:
		id = mochi.uid()
		mochi.db.execute("insert into events ( id, calendar, identity, slug, uid, etag, ics, component, summary, start, finish, allday, recurring, created, updated ) values ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )",
			id, calendar, identity, slug or id, uid, etag, ics, summary["component"], summary.get("summary", ""), summary.get("start", 0), summary.get("finish", 0), 1 if summary.get("allday") else 0, 1 if summary.get("recurring") else 0, now, now)
	calendar_touch(calendar, id)
	after = event_get(identity, id)
	reminders_schedule(after)
	return after

def event_delete(identity, row):
	reminders_cancel(row["id"])
	mochi.db.execute("delete from events where id=? and identity=?", row["id"], identity)
	calendar_touch(row["calendar"], row["id"], 1)
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
	text = mochi.ical.format(calendar_wrap(clean))
	if not text or len(text) > _ICS_MAXIMUM:
		return None
	return text

# === Reminders ===
# Each VALARM with a relative TRIGGER schedules a notification per occurrence
# within the window. A changed or deleted event cancels its own.

def reminders_cancel(event):
	for row in mochi.db.rows("select schedule from reminders where event=?", event):
		if row["schedule"] > 0:
			mochi.schedule.cancel(row["schedule"])
	mochi.db.execute("delete from reminders where event=?", event)

def event_leads(tree):
	leads = []
	for component in tree.get("components", []):
		if type(component) != "dict" or component.get("name") != "VEVENT":
			continue
		for alarm in component.get("components", []):
			if type(alarm) != "dict" or alarm.get("name") != "VALARM":
				continue
			seconds = duration_seconds(property_value(alarm, "TRIGGER"))
			if seconds != None and seconds <= 0 and -seconds not in leads:
				leads.append(-seconds)
		# Overrides carry the master's alarms in practice; one pass is enough.
		break
	return leads

def reminders_schedule(row):
	reminders_cancel(row["id"])
	if not row or row["component"] != "VEVENT":
		return
	tree = mochi.ical.parse(row["ics"])
	if not tree:
		return
	leads = event_leads(tree)
	if not leads:
		return
	now = mochi.time.now()
	for instance in mochi.ical.instances(row["ics"], now, now + _REMINDER_WINDOW):
		for lead in leads:
			at = instance["start"] - lead
			if at < now:
				continue
			scheduled = mochi.schedule.at("schedule_reminder", {"event": row["id"], "instance": instance["start"], "lead": lead}, at)
			mochi.db.execute("insert or replace into reminders ( event, instance, schedule ) values ( ?, ?, ? )", row["id"], instance["start"], scheduled.id if scheduled else 0)

def schedule_reminder(e):
	if e.source != "schedule":
		return
	data = e.data
	row = event_get(e.user.identity.id, data.get("event", "")) if e.user else None
	instance = data.get("instance", 0)
	mochi.db.execute("delete from reminders where event=? and instance=?", data.get("event", ""), instance)
	if not row:
		return
	# The occurrence must still exist: the event may have moved since.
	found = False
	for occurrence in mochi.ical.instances(row["ics"], instance, instance + 1):
		if occurrence["start"] == instance:
			found = True
	if not found:
		return
	calendar = mochi.db.row("select id from calendars where id=?", row["calendar"])
	title = row["summary"] or mochi.app.label("notifications.reminder.untitled")
	body = mochi.app.label("notifications.reminder.body", time=mochi.time.local(instance, "time"))
	url = "/calendars/?view=day&date=" + mochi.time.local(instance, "date")
	mochi.service.call("notifications", "send", "reminder", row["id"], title, body, url,
		mochi.app.label("notifications.topic.reminder"), event=row["id"] + ":" + str(instance))
	# A recurring event keeps one occurrence scheduled past the window.
	if row["recurring"] == 1:
		reminders_topup(row)

def reminders_topup(row):
	latest = mochi.db.row("select max(instance) as instance from reminders where event=?", row["id"])
	after = latest["instance"] if latest and latest["instance"] else mochi.time.now()
	leads = event_leads(mochi.ical.parse(row["ics"]) or {})
	if not leads:
		return
	now = mochi.time.now()
	for instance in mochi.ical.instances(row["ics"], after + 1, now + _REMINDER_WINDOW):
		for lead in leads:
			at = instance["start"] - lead
			if at < now:
				continue
			scheduled = mochi.schedule.at("schedule_reminder", {"event": row["id"], "instance": instance["start"], "lead": lead}, at)
			mochi.db.execute("insert or replace into reminders ( event, instance, schedule ) values ( ?, ?, ? )", row["id"], instance["start"], scheduled.id if scheduled else 0)

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

def birthdays_contacts(identity):
	if not identity or not mochi.service.exists("contacts"):
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

# birthdays_instances(start, finish, colour, calendar) -> list: one all-day
# occurrence per contact per year in the range.
def birthdays_instances(identity, start, finish, colour, calendar):
	out = []
	first = int(mochi.time.local(start, "date")[:4]) - 1
	last = int(mochi.time.local(finish, "date")[:4]) + 1
	for contact in birthdays_contacts(identity):
		for year in range(first, last + 1):
			day = birthday_date(year, contact["month"], contact["day"])
			if day == None or day + 86400 <= start or day >= finish:
				continue
			out.append({
				"event": "birthday-" + contact["id"],
				"calendar": calendar,
				"uid": "birthday-" + contact["id"],
				"summary": mochi.app.label("birthday.summary", name=contact["name"]),
				"location": "", "description": "", "status": "",
				"start": day, "finish": day + 86400, "allday": True, "date": mochi.time.local(day, "date"),
				"recurring": True, "exception": False, "colour": colour, "readonly": True,
			})
	return out

def birthday_object(contact, calendar):
	year = contact["year"] or 1900
	start = date_text(year, contact["month"], contact["day"])
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

# subscription_ingest(row, text) -> int or string: replace a subscription's
# events with those in the fetched text. Events are grouped by uid so a
# recurring event and its overrides stay one object. Returns the count, or an
# error code.
def subscription_ingest(row, text):
	if type(text) != "string" or len(text) > _SUBSCRIPTION_BYTES_MAXIMUM:
		return "too_large"
	tree = mochi.ical.parse(text)
	if not tree:
		return "invalid"
	timezones = [c for c in tree.get("components", []) if type(c) == "dict" and c.get("name") == "VTIMEZONE"]
	groups = {}
	order = []
	for c in tree.get("components", []):
		if type(c) != "dict" or c.get("name") not in ("VEVENT", "VTODO", "VJOURNAL"):
			continue
		uid = property_value(c, "UID") or mochi.crypto.hash.sha256(json.encode(c))[:32]
		if uid not in groups:
			groups[uid] = []
			order.append(uid)
			if len(order) > _SUBSCRIPTION_EVENTS_MAXIMUM:
				return "too_large"
		groups[uid].append(c)
	identity = row["identity"]
	seen = {}
	for uid in order:
		ics = mochi.ical.format(calendar_wrap(groups[uid], timezones))
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
	for event in mochi.db.rows("select * from events where calendar=?", row["id"]):
		if event["id"] not in seen:
			event_delete(identity, event)
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

def poll_schedule(calendar, delay):
	mochi.schedule.after("schedule_calendars_poll", {"calendar": calendar}, max(delay, 10))

# ensure_polls(): a poll scheduled for every subscription, and the daily
# watchdog that re-creates lost ones. One schedule listing covers them all.
def ensure_polls():
	subscriptions = mochi.db.rows("select id, next from calendars where kind='subscription'")
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
	row = mochi.db.row("select * from calendars where id=? and kind='subscription'", calendar)
	if not row:
		return
	now = mochi.time.now()
	token = mochi.uid()
	mochi.db.execute("delete from polls where expires <= ?", now)
	mochi.db.execute("insert into polls ( calendar, token, expires ) values ( ?, ?, ? ) on conflict do nothing", calendar, token, now + 400)
	lock = mochi.db.row("select token from polls where calendar=?", calendar)
	if not lock or lock["token"] != token:
		return
	safety = mochi.schedule.after("schedule_calendars_poll", {"calendar": calendar}, 360)
	if row["next"] <= now:
		subscription_fetch(row)
	safety.cancel()
	after = mochi.db.row("select next from calendars where id=?", calendar)
	if after:
		poll_schedule(calendar, after["next"] - mochi.time.now())
	mochi.db.execute("delete from polls where calendar=? and token=?", calendar, token)

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

def action_calendar_subscribe(a):
	identity = a.user.identity.id
	calendars_ensure(identity)
	url = a.input("url", "").strip()
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
	if not name or len(name) > _NAME_MAXIMUM or not mochi.text.valid(name, "name"):
		name = url.split("//", 1)[1].split("/")[0][:_NAME_MAXIMUM]
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

def action_calendar_poll(a):
	identity = a.user.identity.id
	row = calendar_get(identity, a.input("calendar", ""))
	if not row or row["kind"] != "subscription":
		a.error.label(404, "errors.calendar_not_found")
		return
	changed = subscription_fetch(row, True)
	return {"data": {"changed": changed, "calendar": calendar_public(calendar_get(identity, row["id"]))}}

# === Actions: events ===

def range_input(a):
	start = a.input("start", "")
	finish = a.input("finish", "")
	if not start.isdigit() or not finish.isdigit() or len(start) > 12 or len(finish) > 12:
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
			for instance in mochi.ical.instances(row["ics"], start, finish):
				instance["event"] = row["id"]
				instance["calendar"] = calendar["id"]
				instance["colour"] = calendar["colour"]
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
def recurrence_ends(row):
	for line in row["ics"].replace("\r\n ", "").split("\r\n"):
		if not line.startswith("RRULE:"):
			continue
		rule = line[6:]
		if "UNTIL=" not in rule and "COUNT=" not in rule:
			return None
		last = 0
		for instance in mochi.ical.instances(row["ics"], row["start"], row["start"] + 100 * 366 * 86400):
			if instance["finish"] > last:
				last = instance["finish"]
		return last
	# RDATE-only recurrences are bounded by their dates.
	last = 0
	for instance in mochi.ical.instances(row["ics"], row["start"], row["start"] + 100 * 366 * 86400):
		if instance["finish"] > last:
			last = instance["finish"]
	return last

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
			for contact in birthdays_contacts(identity):
				if contact["year"]:
					born = birthday_date(contact["year"], contact["month"], contact["day"])
					if born and (first == 0 or born < first):
						first = born
				endless = True
			continue
		for row in mochi.db.rows("select id, ics, start, finish, recurring from events where calendar=? and component='VEVENT'", calendar["id"]):
			if row["start"] and (first == 0 or row["start"] < first):
				first = row["start"]
			if row["recurring"] == 1:
				ends = recurrence_ends(row)
				if ends == None:
					endless = True
				elif ends > last:
					last = ends
			elif max(row["finish"], row["start"]) > last:
				last = max(row["finish"], row["start"])
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
		a.error.label(400, "errors.event_not_found")
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
	else:
		a.error.label(400, "errors.invalid_event")

def action_event_create(a):
	identity = a.user.identity.id
	calendars_ensure(identity)
	body = body_json(a)
	if body == None:
		a.error.label(400, "errors.invalid_event")
		return
	calendar = calendar_get(identity, body.get("calendar", "")) if body.get("calendar") else calendar_by_slug(identity, "default")
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
	if events_full(identity):
		a.error.label(400, "errors.too_many_events")
		return
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
		mochi.db.execute("update events set calendar=?, slug=?, updated=? where id=? and identity=?", target["id"], slug, mochi.time.now(), row["id"], identity)
		calendar_touch(row["calendar"], row["id"], 1)
		row = event_get(identity, row["id"])
	written = event_write(identity, target["id"], row["slug"], ics, row)
	if type(written) == "string":
		event_error(a, written)
		return
	return {"data": {"event": event_full(written)}}

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
	event_delete(identity, row)
	return {"data": {}}

def action_events_changes(a):
	identity = a.user.identity.id
	since = a.input("since", "0") or "0"
	if not since.isdigit() or len(since) > 18:
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
	for link in mochi.db.rows("select hash from links where calendar=?", row["id"]):
		mochi.token.delete(link["hash"])
	mochi.db.execute("delete from links where calendar=?", row["id"])
	return {"data": {}}

# calendar_text(row) -> string: the whole calendar as one iCalendar text.
def calendar_text(row):
	name = mochi.entity.name(row["id"]) or ""
	components = []
	timezones = {}
	if row["kind"] == "birthdays":
		for contact in birthdays_contacts(row["identity"]):
			tree = mochi.ical.parse(birthday_object(contact, row["id"])["ics"])
			if tree:
				components.extend(tree.get("components", []))
	else:
		for event in mochi.db.rows("select ics from events where calendar=? order by start limit ?", row["id"], _INSTANCES_MAXIMUM):
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
	calendar = calendar_wrap(components, timezones.values())
	if name:
		calendar["properties"].append({"name": "X-WR-CALNAME", "params": {}, "value": name})
	if not components:
		# An empty VCALENDAR is not valid; a placeholder keeps the link usable.
		return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:" + _PRODID + "\r\nX-WR-CALNAME:" + name.replace("\n", " ") + "\r\nEND:VCALENDAR\r\n"
	return mochi.ical.format(calendar)

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

# === Actions: preferences ===

_PREFERENCES = {"hours": {"start": 8, "finish": 17}, "days": [1, 2, 3, 4, 5], "multiweek": {"weeks": 4, "previous": 0}, "duration": 60, "reminder": _REMINDER_DEFAULT, "view": "month"}

def preferences_read(a):
	stored = json.decode(a.user.preference.get("calendars") or "{}", None)
	out = {}
	for key in _PREFERENCES:
		out[key] = stored.get(key, _PREFERENCES[key]) if type(stored) == "dict" else _PREFERENCES[key]
	return out

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
	out = {
		"hours": {"start": start, "finish": finish},
		"days": sorted(set(days)) if days else [],
		"multiweek": {"weeks": bounded(multiweek.get("weeks"), 2, 8, current["multiweek"]["weeks"]), "previous": bounded(multiweek.get("previous"), 0, 2, current["multiweek"]["previous"])},
		"duration": bounded(body.get("duration", current["duration"]), 0, 1440, current["duration"]),
		"reminder": bounded(body.get("reminder", current["reminder"]), -1, 10080, current["reminder"]),
		"view": view,
	}
	a.user.preference.set("calendars", json.encode(out))
	return {"data": {"preferences": out}}

# === Actions: device tokens ===
# The credential a CalDAV client holds: the dav scope, bound to the caldav
# route, one per device, never expiring because it is bound.

def token_name_input(a):
	name = a.input("name", "").strip()
	if not name or len(name) > 100:
		a.error.label(400, "errors.token_name_is_too_long_max_100_characters")
		return None
	return name

def action_token_create(a):
	name = token_name_input(a)
	if name == None:
		return
	token = mochi.token.create(name, ["dav"], 0, "caldav/*path", "")
	if not token:
		a.error.label(500, "errors.failed_to_create_token")
		return
	return {"data": {"token": token}}

# Only the device credentials: the app's ICS link tokens are bound to the
# calendar address and are revoked from the calendar, not from the device list.
def action_token_list(a):
	return {"data": {"tokens": [t for t in (mochi.token.list() or []) if t.get("action") == "caldav/*path"]}}

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
		return [dav_collection(row)] if row else []
	return [dav_collection(row) for row in calendars_rows(identity)]

def function_dav_collection_create(context, identity, collection, name="", description=""):
	if not dav_caller(context):
		return {"error": "forbidden"}
	if not identity or not slug_valid(collection):
		return {"error": "invalid"}
	if calendar_by_slug(identity, collection):
		return {"error": "exists"}
	calendars_ensure(identity)
	label = name.strip() if type(name) == "string" else ""
	if not label or len(label) > _NAME_MAXIMUM or not mochi.text.valid(label, "name"):
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
		objects = [birthday_object(contact, calendar["id"]) for contact in birthdays_contacts(identity)]
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
	if not row and events_full(identity):
		return {"error": "full"}
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
	event_delete(identity, row)
	return {}
