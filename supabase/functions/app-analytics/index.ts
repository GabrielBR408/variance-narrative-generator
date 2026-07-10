// ChiefEO app-analytics Edge Function (v7)
//
// v7 = v5 feature set RESTORED + v6's feedback feed. v6 (deployed 2026-07-10)
// was rebuilt from a pre-v5 base and dropped allApps, internal-traffic
// filtering, the devices list, visits, and the POST exclude/include handler —
// which broke the dashboard's app dropdown and internal-traffic controls.
//
// Returns aggregated usage stats per app from public.app_events, using the
// service-role key (auto-injected into Edge Functions) so it can read past
// the anon insert-only RLS policy. Gated by a bearer token stored as the
// DASHBOARD_TOKEN secret — set with:
//   supabase secrets set DASHBOARD_TOKEN=<token> --project-ref dsmbppzvembacitwdrsj
//
// GET query params:
//   range    = 7d | 30d | 90d | all   (default 30d)
//   app      = optional app name filter (applied in-memory so allApps stays complete)
//   internal = 1 to INCLUDE internal/own traffic (default: excluded)
//
// POST body (manage internal-device exclusion list):
//   { "action": "exclude" | "include", "device_id": "<id>", "note": "optional" }
//
// Internal traffic = events whose session_id (a persistent per-device
// localStorage id) is in public.internal_devices, OR whose properties
// contain a truthy "internal" flag (set by the app tracking snippet).
//
// Response keeps all v4 fields (timeseries, eventsByApp, eventsByName,
// hourOfDay, uniqueSessions, eventsToday, eventsThisWeek, activeDays,
// recentEvents, apps[]) plus: allApps[], appFilter, internalIncluded,
// hiddenInternalEvents, uniqueDevices, visits, devicesByPlatform, devices[],
// and feedback[] (from v6: user-submitted 'feedback' events, newest first,
// internal flag preserved so the dashboard can hide internal traffic).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const FUNNEL_STEPS = [
  { key: 'opened', label: 'Opened', match: (e) => e === 'app_opened' },
  { key: 'uploaded', label: 'Uploaded', match: (e) => e.includes('upload') || e.includes('photo') },
  { key: 'success', label: 'Success / Export', match: (e) => e.includes('success') || e.includes('export') || e.includes('complete') },
]
const isError = (e) => e.includes('error') || e.includes('fail')
const isSuccess = (e) => e.includes('success') || e.includes('export') || e.includes('complete')

// Diagnostic detail keys forwarded from properties into recentErrors. Bounded
// whitelist: apps only ever put enum-like codes/flags in these (privacy-safe).
const DETAIL_KEYS = ['code', 'source', 'online', 'mic', 'ua']
function pickDetail(props) {
  if (!props || typeof props !== 'object') return null
  const out = {}
  for (const k of DETAIL_KEYS) {
    if (props[k] !== undefined && props[k] !== null) out[k] = String(props[k]).slice(0, 64)
  }
  return Object.keys(out).length ? out : null
}

const PAGE_SIZE = 1000
const MAX_ROWS = 50000
const SESSION_GAP_MS = 30 * 60 * 1000 // >30 min idle = new visit

// Event-level internal check: apps self-tag via the #internal URL flag.
function propsInternal(props) {
  return !!props && (props.internal === true || props.internal === 'true')
}

// session_id in app_events is a persistent per-device localStorage id, so
// "device" here = browser profile per app origin — close enough to a user
// for these low-volume apps.
function platformOf(ua) {
  ua = ua || ''
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows'
  return ua ? 'Other' : 'Unknown'
}
function browserOf(ua) {
  ua = ua || ''
  if (/Edg\//i.test(ua)) return 'Edge'
  if (/CriOS|Chrome\//i.test(ua)) return 'Chrome'
  if (/FxiOS|Firefox\//i.test(ua)) return 'Firefox'
  if (/Safari\//i.test(ua)) return 'Safari'
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  const expected = Deno.env.get('DASHBOARD_TOKEN')
  const auth = req.headers.get('authorization') || ''
  if (!expected || auth !== `Bearer ${expected}`) {
    return json({ error: 'unauthorized' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  )

  try {
    if (req.method === 'POST') return await handlePost(req, supabase)

    const url = new URL(req.url)
    const range = url.searchParams.get('range') || '30d'
    const appFilter = url.searchParams.get('app') || null
    const includeInternal = url.searchParams.get('internal') === '1'
    const since = rangeToSince(range)

    // Internal-device exclusion list (hard filter, managed via POST).
    const { data: intRows, error: intErr } = await supabase
      .from('internal_devices')
      .select('device_id')
    if (intErr) throw new Error(intErr.message)
    const internalSet = new Set((intRows || []).map((r) => r.device_id))

    // Fetch WITHOUT the app filter so allApps + the devices list stay complete;
    // the app filter is applied in-memory below.
    const rows = await fetchAllEvents(supabase, since)

    const isInternal = (r) => internalSet.has(r.session_id) || propsInternal(r.properties)

    const allApps = [...new Set(rows.map((r) => r.app || 'unknown'))].sort()

    const appRows = appFilter ? rows.filter((r) => (r.app || 'unknown') === appFilter) : rows
    const visibleRows = includeInternal ? appRows : appRows.filter((r) => !isInternal(r))
    const hiddenInternalEvents = appRows.length - visibleRows.length

    const byApp = groupBy(visibleRows, (r) => r.app || 'unknown')
    const apps = Object.entries(byApp)
      .map(([app, rowsForApp]) => buildAppStats(app, rowsForApp))
      .sort((a, b) => b.totalEvents - a.totalEvents)

    const overview = buildOverview(visibleRows)

    return json({
      range,
      since,
      generatedAt: new Date().toISOString(),
      rowCount: visibleRows.length,
      truncated: rows.length >= MAX_ROWS,
      appFilter,
      internalIncluded: includeInternal,
      hiddenInternalEvents,
      allApps,
      apps,
      ...overview,
      // Devices list is intentionally unfiltered (all apps, internal included)
      // so excluded devices stay visible/dimmed and can be re-included, and
      // your own device shows up regardless of the current filters.
      devices: buildDevices(rows, internalSet),
      feedback: buildFeedback(appRows, internalSet),
    })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// POST { action: 'exclude'|'include', device_id, note? } -> manage internal_devices.
async function handlePost(req, supabase) {
  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }
  const action = body && body.action
  const deviceId = body && typeof body.device_id === 'string' ? body.device_id.trim() : ''
  if (!deviceId || (action !== 'exclude' && action !== 'include')) {
    return json({ error: 'expected { action: "exclude"|"include", device_id }' }, 400)
  }
  if (action === 'exclude') {
    const note = body.note == null ? null : String(body.note).slice(0, 200)
    const { error } = await supabase
      .from('internal_devices')
      .upsert({ device_id: deviceId, note }, { onConflict: 'device_id' })
    if (error) return json({ error: error.message }, 500)
  } else {
    const { error } = await supabase
      .from('internal_devices')
      .delete()
      .eq('device_id', deviceId)
    if (error) return json({ error: error.message }, 500)
  }
  return json({ ok: true, action, device_id: deviceId })
}

function rangeToSince(range) {
  const now = Date.now()
  if (range === '7d') return new Date(now - 7 * 86400000).toISOString()
  if (range === '30d') return new Date(now - 30 * 86400000).toISOString()
  if (range === '90d') return new Date(now - 90 * 86400000).toISOString()
  return null
}

// UTC calendar date (YYYY-MM-DD) of an ISO timestamp.
function ymd(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : ''
}
function addDays(dateStr, n) {
  const t = new Date(dateStr + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

// Cross-app aggregates for the dashboard's global charts & feed, computed from
// the visible (filtered) rows. App/event names are collected dynamically — new
// instrumented apps appear automatically. All date/hour bucketing is UTC.
const RECENT_FEED_SIZE = 60
function buildOverview(rows) {
  const dailyTotals = {}          // 'YYYY-MM-DD' -> count
  const dailyByApp = {}           // app -> { 'YYYY-MM-DD' -> count }
  const eventsByApp = {}          // app -> count
  const eventsByName = {}         // event name -> count
  const hourOfDay = new Array(24).fill(0)
  const devices = new Set()
  const devicePlatform = {}       // device -> platform (last seen wins; rows are newest-first)
  const eventsByDevice = {}       // device -> event times for sessionization
  let minDate = null

  for (const r of rows) {
    const d = ymd(r.created_at)
    if (!d) continue
    if (!minDate || d < minDate) minDate = d
    const app = r.app || 'unknown'
    dailyTotals[d] = (dailyTotals[d] || 0) + 1
    eventsByApp[app] = (eventsByApp[app] || 0) + 1
    eventsByName[r.event] = (eventsByName[r.event] || 0) + 1
    if (!dailyByApp[app]) dailyByApp[app] = {}
    dailyByApp[app][d] = (dailyByApp[app][d] || 0) + 1
    if (r.session_id) {
      devices.add(r.session_id)
      if (!(r.session_id in devicePlatform)) devicePlatform[r.session_id] = platformOf(r.user_agent)
      if (!eventsByDevice[r.session_id]) eventsByDevice[r.session_id] = []
      const ts = new Date(r.created_at).getTime()
      if (!isNaN(ts)) eventsByDevice[r.session_id].push(ts)
    }
    const t = new Date(r.created_at)
    if (!isNaN(t.getTime())) hourOfDay[t.getUTCHours()]++
  }

  // Visits: gap-based sessionization per device (>30 min idle = new visit).
  let visits = 0
  for (const id of Object.keys(eventsByDevice)) {
    const times = eventsByDevice[id].sort((a, b) => a - b)
    visits++
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] > SESSION_GAP_MS) visits++
    }
  }

  const devicesByPlatform = {}
  for (const id of Object.keys(devicePlatform)) {
    const p = devicePlatform[id]
    devicesByPlatform[p] = (devicesByPlatform[p] || 0) + 1
  }

  // Contiguous, zero-filled date axis from earliest event through today (UTC),
  // so sparse ranges still render a continuous timeline and "today" always shows.
  const today = new Date().toISOString().slice(0, 10)
  const dates = []
  if (minDate) {
    const end = minDate > today ? minDate : today
    let cur = minDate
    let guard = 0
    while (cur <= end && guard < 100000) {
      dates.push(cur)
      cur = addDays(cur, 1)
      guard++
    }
  }
  const totals = dates.map((d) => dailyTotals[d] || 0)
  const appSeries = {}
  for (const app of Object.keys(dailyByApp)) {
    appSeries[app] = dates.map((d) => dailyByApp[app][d] || 0)
  }

  const weekStart = addDays(today, -6) // rolling 7 days incl. today
  let eventsToday = 0
  let eventsThisWeek = 0
  for (const d of Object.keys(dailyTotals)) {
    if (d === today) eventsToday += dailyTotals[d]
    if (d >= weekStart && d <= today) eventsThisWeek += dailyTotals[d]
  }

  const recentEvents = rows.slice(0, RECENT_FEED_SIZE).map((r) => ({
    time: r.created_at,
    app: r.app || 'unknown',
    event: r.event,
    device: r.session_id ? String(r.session_id).slice(0, 8) : null,
  }))

  return {
    timeseries: { dates, totals, apps: appSeries },
    eventsByApp,
    eventsByName,
    hourOfDay,
    uniqueSessions: devices.size,
    uniqueDevices: devices.size,
    visits,
    devicesByPlatform,
    eventsToday,
    eventsThisWeek,
    activeDays: Object.keys(dailyTotals).length,
    recentEvents,
  }
}

// Per-device rollup for the management table. Built from ALL rows in range
// (no app/internal filter) and sorted newest-activity-first. Rows arrive
// newest-first, so the first sighting of a device gives lastSeen + freshest UA.
function buildDevices(rows, internalSet) {
  const map = {}
  for (const r of rows) {
    const id = r.session_id
    if (!id) continue
    if (!map[id]) {
      map[id] = {
        device_id: id,
        platform: platformOf(r.user_agent),
        browser: browserOf(r.user_agent),
        apps: new Set(),
        events: 0,
        lastSeen: r.created_at,
        flagged: false,
        internal: internalSet.has(id),
      }
    }
    const d = map[id]
    d.events++
    d.apps.add(r.app || 'unknown')
    if (propsInternal(r.properties)) d.flagged = true
  }
  return Object.values(map)
    .map((d) => ({ ...d, apps: [...d.apps].sort() }))
    .sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')))
}

// User-submitted feedback rows (event === 'feedback'), newest first (from v6).
// The free-text message is forwarded verbatim — it is text the user typed
// deliberately in order to send it to us — but bounded, and only the known
// feedback fields are picked out of properties. `internal` rides along (event
// self-tag OR excluded device) so the dashboard can hide internal traffic.
const FEEDBACK_FEED_SIZE = 200
function buildFeedback(rows, internalSet) {
  const out = []
  for (const r of rows) {
    if (r.event !== 'feedback') continue
    const p = r.properties && typeof r.properties === 'object' ? r.properties : {}
    out.push({
      time: r.created_at,
      app: r.app || 'unknown',
      feedback_type: String(p.feedback_type || 'other').slice(0, 32),
      message: String(p.message || '').slice(0, 2000),
      version: p.version == null ? null : String(p.version).slice(0, 64),
      commit: p.commit == null ? null : String(p.commit).slice(0, 64),
      screen: p.screen == null ? null : String(p.screen).slice(0, 64),
      internal: propsInternal(p) || internalSet.has(r.session_id),
    })
    if (out.length >= FEEDBACK_FEED_SIZE) break
  }
  return out
}

async function fetchAllEvents(supabase, since) {
  let all = []
  let from = 0
  while (all.length < MAX_ROWS) {
    let q = supabase
      .from('app_events')
      .select('app, event, session_id, properties, created_at, user_agent')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (since) q = q.gte('created_at', since)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

function groupBy(arr, fn) {
  const out = {}
  for (const item of arr) {
    const k = fn(item)
    if (!out[k]) out[k] = []
    out[k].push(item)
  }
  return out
}

function buildAppStats(app, rows) {
  const eventCounts = {}
  const openedSessions = new Set()
  let successCount = 0
  let errorCount = 0
  const recentErrors = []

  for (const r of rows) {
    const ev = (r.event || '').toLowerCase()
    eventCounts[r.event] = (eventCounts[r.event] || 0) + 1

    if (ev === 'app_opened' && r.session_id) openedSessions.add(r.session_id)

    if (isError(ev)) {
      errorCount++
      if (recentErrors.length < 10) {
        recentErrors.push({
          reason: r.properties?.reason || r.properties?.message || r.event,
          detail: pickDetail(r.properties),
          time: r.created_at,
        })
      }
    } else if (isSuccess(ev)) {
      successCount++
    }
  }

  const funnel = FUNNEL_STEPS.map((step) => {
    const sessions = new Set()
    for (const r of rows) {
      const ev = (r.event || '').toLowerCase()
      if (step.match(ev) && r.session_id) sessions.add(r.session_id)
    }
    return { step: step.key, label: step.label, count: sessions.size }
  })
  const base = funnel[0]?.count || 0
  for (const f of funnel) {
    f.dropoffPct = base > 0 ? Math.round((1 - f.count / base) * 1000) / 10 : 0
  }

  const totalOutcomes = successCount + errorCount
  return {
    app,
    totalEvents: rows.length,
    totalSessions: openedSessions.size,
    eventCounts,
    funnel,
    successCount,
    errorCount,
    successRate: totalOutcomes > 0 ? Math.round((successCount / totalOutcomes) * 1000) / 10 : null,
    recentErrors, // rows arrive newest-first, so first 10 encountered are already most recent
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
