// =====================================================================
// Meeting Ignite · the meeting on the record
//
// Meeting-only helpers. The shared mi-session.js stays identical across
// the five tools; anything only Meeting needs lives here.
//
// A meeting is one row in app.sessions with tool 'meeting'. It is saved
// when the guide is generated, and the close is added to the same row.
// A meeting opens no thread: a thread is one piece of work about one
// person, and a meeting sits across them.
//
// Every function answers { data, error }. A write that returns no row is
// an error, never a quiet success.
// =====================================================================

const SESSION_FIELDS = 'id, tool, title, person_id, thread_id, inputs, outputs, occurred_at';

/** Save a newly prepared meeting to the manager's record. */
export async function saveMeeting(client, { title, inputs, outputs, personId = null }) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { data: null, error: new Error('Not signed in.') };

  const { data, error } = await client.schema('app').from('sessions').insert({
    account_id: user.id,
    person_id: personId,
    thread_id: null,
    tool: 'meeting',
    title: title || null,
    inputs: inputs || {},
    outputs: outputs || {},
  }).select(SESSION_FIELDS).maybeSingle();

  if (error || !data) {
    console.error('saveMeeting: the meeting was not saved:', error?.message || 'no row returned');
    return { data: null, error: error || new Error('The meeting was not returned.') };
  }
  return { data, error: null };
}

/** Add to a saved meeting's outputs (the close), keeping what is there. */
export async function updateMeetingOutputs(client, session, extra) {
  if (!session?.id) return { data: null, error: new Error('There is no saved meeting to add to.') };
  const outputs = { ...(session.outputs || {}), ...extra };
  const { data, error } = await client.schema('app').from('sessions')
    .update({ outputs })
    .eq('id', session.id)
    .select(SESSION_FIELDS)
    .maybeSingle();
  if (error || !data) {
    console.error('updateMeetingOutputs: the close was not saved:', error?.message || 'no row returned', session.id);
    return { data: null, error: error || new Error('The meeting could not be found to add the close.') };
  }
  return { data, error: null };
}

/** The manager's meetings, newest first, for the History panel. */
export async function listMeetings(client, limit = 20) {
  const { data, error } = await client.schema('app').from('sessions')
    .select(SESSION_FIELDS)
    .eq('tool', 'meeting')
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('listMeetings failed:', error.message);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

// ---------------------------------------------------------------------
// The 1-1: the agenda is assembled from the record, not typed
// ---------------------------------------------------------------------

/** The manager's active team, for choosing who a meeting is with. */
export async function listTeam(client) {
  const { data, error } = await client.schema('app').from('people')
    .select('id, first_name, last_name, role_title')
    .eq('status', 'active')
    .order('first_name');
  if (error) {
    console.error('listTeam failed:', error.message);
    return { data: [], error };
  }
  return { data: data || [], error: null };
}

/**
 * Everything the record holds that a 1-1 with this person should review.
 * Answers { data: { person, openActions, recentSessions, openThreads }, error }.
 * Any failed read is an error: an agenda built from half a record would
 * leave things out without saying so.
 */
export async function loadPersonContext(client, personId) {
  if (!personId) return { data: null, error: new Error('No person was chosen.') };
  const db = client.schema('app');
  const [p, a, s, t] = await Promise.all([
    db.from('people').select('id, first_name, last_name, role_title').eq('id', personId).maybeSingle(),
    db.from('actions').select('id, description, owner, due_on, status, session_id, created_at')
      .eq('person_id', personId).eq('status', 'open')
      .order('due_on', { ascending: true, nullsFirst: false }),
    db.from('sessions').select('id, tool, title, thread_id, inputs, outputs, occurred_at')
      .eq('person_id', personId)
      .order('occurred_at', { ascending: false }).limit(60),
    db.from('threads').select('id, title, status, updated_at').eq('person_id', personId).eq('status', 'open'),
  ]);
  const failed = [p, a, s, t].find((r) => r.error);
  if (failed) {
    console.error('loadPersonContext failed:', failed.error.message);
    return { data: null, error: failed.error };
  }
  if (!p.data) {
    console.error('loadPersonContext: no person with that id for this account.', personId);
    return { data: null, error: new Error('That person could not be found on your team.') };
  }
  return {
    data: {
      person: p.data,
      openActions: a.data || [],
      recentSessions: s.data || [],
      openThreads: t.data || [],
    },
    error: null,
  };
}

const ukDay = (iso) => {
  if (!iso) return '';
  const d = new Date(String(iso).length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
};
const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Is this saved meeting a 1-1? */
export function isOneToOne(session) {
  return session?.tool === 'meeting' && session?.inputs?.meetingType === 'oneToOne';
}

/**
 * Turn the record into agenda items. Pure and deterministic: every word of
 * every item comes from the manager's own saved text or from a date or level
 * the tools calculated. Nothing here is written by a model.
 *
 * Each item: { key, kind, title, lines }. `title` is the phrase the agenda
 * must carry word for word; the page checks for it after generation.
 */
export function assembleOneToOne(ctx, todayIso = new Date().toISOString().slice(0, 10)) {
  if (!ctx) return { items: [], lastOneToOne: null };
  const first = ctx.person.first_name || 'They';
  const sessions = ctx.recentSessions || [];
  const openThreadIds = new Set((ctx.openThreads || []).map((t) => t.id));
  const threadTitle = Object.fromEntries((ctx.openThreads || []).map((t) => [t.id, t.title]));

  // Work: one item per open thread, plus any piece of work saved before
  // threads existed. Meetings are not work items.
  const groups = new Map();
  for (const s of sessions) {
    if (s.tool === 'meeting') continue;
    if (s.thread_id && !openThreadIds.has(s.thread_id)) continue; // closed work stays closed
    const key = s.thread_id || `session:${s.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s); // newest first, as read
  }

  const items = [];
  for (const [key, list] of groups) {
    const latest = (tool) => list.find((s) => s.tool === tool);
    const lines = [];
    const goal = latest('goal');
    const del = latest('delegate');
    const fb = latest('feedback');
    const coach = latest('coach');
    if (goal) {
      const i = goal.inputs || {};
      const extra = [clean(i.stretchLevel) && `stretch ${clean(i.stretchLevel)}`, clean(i.deadline) && `by ${clean(i.deadline)}`].filter(Boolean).join(', ');
      lines.push(`Goal set ${ukDay(goal.occurred_at)}: ${clean(i.goalTitle) || clean(goal.title)}${extra ? ` (${extra})` : ''}.`);
      if (clean(i.successCriteria)) lines.push(`Success looks like: ${clean(i.successCriteria)}`);
    }
    if (del) {
      const i = del.inputs || {};
      const o = del.outputs || {};
      const level = Number(o.delegationLevel) || null;
      lines.push(`Delegated ${ukDay(del.occurred_at)}: ${clean(i.taskTitle) || clean(del.title)}${level ? `, at level ${level}` : ''}.`);
      if (clean(i.deadline)) lines.push(`Check in by: ${clean(i.deadline)}.`);
      const freq = o.cadence && typeof o.cadence === 'object' ? clean(o.cadence.frequency) : '';
      if (freq) lines.push(`Agreed check-ins: ${freq}.`);
    }
    if (fb) {
      const subject = clean(fb.inputs?.subject);
      lines.push(`Feedback given ${ukDay(fb.occurred_at)}${subject ? ` about ${subject}` : ''}.`);
    }
    if (coach) {
      const topic = clean(coach.inputs?.coachingTopic) || clean(coach.title);
      lines.push(`Coaching ${ukDay(coach.occurred_at)}, working on: ${topic}.`);
    }
    if (!lines.length) continue;
    const title = clean(threadTitle[key]) || clean(list[0].title) || 'Untitled piece of work';
    items.push({ key: `work:${key}`, kind: 'work', title, lines, latestAt: list[0].occurred_at });
  }
  items.sort((a, b) => String(b.latestAt).localeCompare(String(a.latestAt)));

  // Actions: every open action, overdue first.
  const ownerWord = { person: `${first}'s action`, manager: 'Your action', shared: 'Shared action' };
  const actions = (ctx.openActions || []).map((a) => {
    const overdue = Boolean(a.due_on && a.due_on < todayIso);
    const due = a.due_on ? (overdue ? `overdue since ${ukDay(a.due_on)}` : `due ${ukDay(a.due_on)}`) : 'no date set';
    return {
      key: `action:${a.id}`,
      kind: 'action',
      actionId: a.id,
      overdue,
      title: clean(a.description),
      due,
      lines: [`${ownerWord[a.owner] || ownerWord.person}, open: ${clean(a.description)} (${due}).`],
    };
  });
  actions.sort((a, b) => Number(b.overdue) - Number(a.overdue));

  const last = sessions.find(isOneToOne) || null;
  return { items: [...items, ...actions], lastOneToOne: last ? ukDay(last.occurred_at) : null };
}

/**
 * The 1-1 agenda, put together in code. The items and their order come from
 * the record and the manager; the model supplies only the opening, one
 * question per item and the close. An item the model gave no question for
 * still appears: the record is never the model's to drop.
 */
export function buildOneToOneAgenda({ items, questions, opening, close }) {
  const out = [];
  if (clean(opening)) out.push(opening.trim(), '');
  let n = 1;
  out.push(`${n}. Your items first`);
  if (questions[0]) out.push(questions[0]);
  out.push('');
  items.forEach((it, i) => {
    n += 1;
    const head = it.kind === 'action' ? `${it.title} (${it.due})` : it.title;
    out.push(`${n}. ${head}`);
    const q = questions[i + 1];
    if (q) out.push(q);
    else console.error('buildOneToOneAgenda: no question came back for item', n, it.title);
    out.push('');
  });
  n += 1;
  out.push(`${n}. What we agree`, 'Who does what, by when, before we finish.');
  if (clean(close)) out.push('', close.trim());
  return out.join('\n');
}

/** Pull "1. question" lines out of the model's QUESTIONS block, by number. */
export function parseQuestions(block) {
  const qs = [];
  for (const line of String(block || '').split('\n')) {
    const m = line.match(/^\s*(\d+)[.)]\s*(.+?)\s*$/);
    if (m) qs[Number(m[1]) - 1] = m[2];
  }
  return qs;
}

// ---------------------------------------------------------------------
// The close: the meeting writes back
// ---------------------------------------------------------------------

/**
 * Write the close in one pass: each reviewed action, each new action and who
 * came. One database transaction (app.close_meeting): all of it or none.
 */
export async function closeMeeting(client, sessionId, { reviews = [], newActions = [], participants = [] }) {
  if (!sessionId) return { data: null, error: new Error('There is no saved meeting to close.') };
  const { data, error } = await client.schema('app').rpc('close_meeting', {
    p_session: sessionId,
    p_reviews: reviews,
    p_new_actions: newActions,
    p_participants: participants,
  });
  if (error || !data) {
    console.error('closeMeeting failed:', error?.message || 'no answer');
    return { data: null, error: error || new Error('The close was not confirmed.') };
  }
  if (data.reviewed !== reviews.length || data.participants !== participants.length) {
    console.error('closeMeeting: counts do not match what was sent', data, reviews.length, participants.length);
  }
  return { data, error: null };
}
