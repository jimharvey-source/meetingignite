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
