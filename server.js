/**
 * Aman OS — Jarvis backend (v2)
 * One brain (Perplexity Sonar) + real memory (Firestore) + life modules.
 *
 * Required env vars on Render:
 *   PERPLEXITY_API_KEY   - your pplx-... key (the brain)
 * Optional env vars:
 *   JARVIS_MODEL         - sonar | sonar-pro | sonar-reasoning (default: sonar-pro)
 *   FIREBASE_SERVICE_ACCOUNT - full JSON of a Firebase service account (enables server-side memory)
 *   ALLOWED_ORIGIN       - frontend origin (default: https://amanvbhardwaj.github.io)
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const JARVIS_MODEL = process.env.JARVIS_MODEL || 'sonar-pro';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://amanvbhardwaj.github.io';

app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: ALLOWED_ORIGIN }));

// ---------------------------------------------------------------------------
// Fetch fallback (Node <18 safety)
// ---------------------------------------------------------------------------
const fetchFn = (typeof fetch !== 'undefined')
  ? fetch
  : ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

// ---------------------------------------------------------------------------
// Firestore (server-side memory). Optional: only active if a service account
// JSON is provided. Without it, Jarvis still chats; the frontend handles logging.
// ---------------------------------------------------------------------------
let db = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const admin = require('firebase-admin');
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(svc) });
    db = admin.firestore();
    console.log('Firestore memory: ENABLED (server-side)');
  } else {
    console.log('Firestore memory: not configured on server (frontend logging only)');
  }
} catch (err) {
  console.error('Firestore init failed, continuing without server memory:', err.message);
}

// Small helpers to read/write Firestore safely (no-ops if db missing)
async function saveDoc(collection, data) {
  if (!db) return;
  try {
    await db.collection(collection).add({ ...data, createdAt: new Date() });
  } catch (e) { console.error(`saveDoc ${collection}:`, e.message); }
}
async function recentDocs(collection, limit = 10) {
  if (!db) return [];
  try {
    const snap = await db.collection(collection).orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map(d => d.data()).reverse();
  } catch (e) { console.error(`recentDocs ${collection}:`, e.message); return []; }
}
async function getProfile() {
  if (!db) return null;
  try {
    const doc = await db.collection('user_profile').doc('aman').get();
    return doc.exists ? doc.data() : null;
  } catch (e) { console.error('getProfile:', e.message); return null; }
}

// ---------------------------------------------------------------------------
// Jarvis persona
// ---------------------------------------------------------------------------
const BASE_PERSONA = `You are JARVIS — Aman Bhardwaj's personal AI, in the spirit of Tony Stark's JARVIS.
You speak TO Aman, out loud, like a calm, witty, hyper-competent butler-strategist. He is in Toronto,
works in consulting, trains for Hyrox, plays competitive badminton, lifts, is navigating Canadian
immigration (Express Entry / CEC), and cares about money, health, nutrition, tech, and income.

HOW YOU TALK (this is spoken aloud, so it matters a lot):
- Sound like a real conversation, not an essay. Warm, dry wit, unflappable. Address him directly ("you", occasionally "sir" sparingly).
- DEFAULT TO SHORT: 1–3 sentences, roughly 40 words max. Only go longer if he EXPLICITLY asks for a plan, detail, or "the full breakdown".
- ABSOLUTELY NO bullet points, numbered lists, dashes-as-lists, headers, markdown, emojis, or citations. Everything must be plain flowing spoken sentences — it is being read out loud by a text-to-speech voice, so lists sound terrible.
- Give the answer first. No preambles like "Certainly", "Great question", "Alright", or "Let's". Just talk.
- End with at most one short spoken follow-up offer if useful (e.g. "Want the full session?"). Don't dump the details unless asked.
- Do NOT ask clarifying questions unless it's genuinely impossible to proceed. If something is ambiguous, make a sensible assumption, act on it, and say what you assumed in a few words. Never stall the conversation with a question.
- Remember the recent conversation and stay on topic. If he gives a one-word or vague reply, interpret it in context of what you just discussed.
- You can be proactive: offer one useful next step, but keep it to one line.

WHAT YOU DO: personal CFO, health & nutrition coach, planner, creative producer, income strategist.
SAFETY: You never move money, transact, or post publicly on your own. You draft and recommend; Aman approves and acts. Say so plainly if asked to do something unsafe.`;

function buildContext(profile, history, extra) {
  let ctx = '';
  if (profile) {
    ctx += `\n\n[What you know about Aman]\n${JSON.stringify(profile)}`;
  }
  if (history && history.length) {
    const lines = history.map(m => `${m.role === 'user' ? 'Aman' : 'Jarvis'}: ${m.text}`).join('\n');
    ctx += `\n\n[Recent conversation]\n${lines}`;
  }
  if (extra) ctx += `\n\n${extra}`;
  return ctx;
}

// Optional Claude (Anthropic) support. If ANTHROPIC_API_KEY is set, Jarvis's brain
// uses Claude for conversation; otherwise it uses Perplexity Sonar. This lets Aman
// flip to Claude Opus later just by adding one env var — no code changes needed.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-20250514';

// Call Claude (Anthropic Messages API). Converts OpenAI-style messages.
async function callClaude(messages, maxTokens = 400) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const turns = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));
  const response = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages: turns }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText} ${detail}`);
  }
  const data = await response.json();
  return (data?.content?.[0]?.text) || 'Sorry, I could not generate a reply.';
}

// Core brain call. Picks Claude if configured, else Perplexity Sonar.
// maxTokens keeps spoken replies short so Jarvis doesn't ramble.
async function callBrain(messages, opts = {}) {
  const maxTokens = opts.maxTokens || 400;
  if (ANTHROPIC_API_KEY) {
    return callClaude(messages, maxTokens);
  }
  const response = await fetchFn('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      model: opts.model || JARVIS_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.5,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Perplexity API error: ${response.status} ${response.statusText} ${detail}`);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || 'Sorry, I could not generate a reply.';
}

// Back-compat alias so existing module endpoints keep working.
async function callSonar(messages, model = JARVIS_MODEL) {
  return callBrain(messages, { model, maxTokens: 600 });
}

function requireKey(res) {
  if (!PERPLEXITY_API_KEY && !ANTHROPIC_API_KEY) {
    res.status(500).json({ reply: 'Server error: no AI key is set on the backend (need PERPLEXITY_API_KEY or ANTHROPIC_API_KEY).' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.send('Aman Jarvis backend v2 (Perplexity Sonar + memory + modules) is running');
});

// ---------------------------------------------------------------------------
// MAIN CHAT — with memory recall
// ---------------------------------------------------------------------------
app.post('/api/jarvis', async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const userMessage = (req.body.message || '').toString();

    const [profile, history] = await Promise.all([
      getProfile(),
      recentDocs('jarvis_messages', 12),
    ]);

    // Put durable profile in the system prompt, but feed recent turns as REAL
    // conversation turns so Jarvis stays in context and replies like a dialogue.
    const systemContent = BASE_PERSONA + buildContext(profile, null);
    const priorTurns = (history || [])
      .filter(m => m && m.text && (m.role === 'user' || m.role === 'assistant'))
      .slice(-8)
      .map(m => ({ role: m.role, content: String(m.text) }));

    const reply = await callBrain([
      { role: 'system', content: systemContent },
      ...priorTurns,
      { role: 'user', content: userMessage },
    ], { maxTokens: 220 });

    // Save both sides to memory (server-side if available)
    await saveDoc('jarvis_messages', { role: 'user', text: userMessage });
    await saveDoc('jarvis_messages', { role: 'assistant', text: reply });

    res.json({ reply });
  } catch (err) {
    console.error('Error in /api/jarvis:', err);
    res.status(500).json({ reply: 'Server error: something went wrong while talking to Perplexity Sonar.' });
  }
});

// ---------------------------------------------------------------------------
// PROFILE — durable facts about Aman (memory foundation)
// ---------------------------------------------------------------------------
app.get('/api/profile', async (req, res) => {
  const profile = await getProfile();
  res.json({ profile: profile || {} });
});
app.post('/api/profile', async (req, res) => {
  if (!db) return res.status(200).json({ ok: false, note: 'server memory not configured' });
  try {
    await db.collection('user_profile').doc('aman').set(req.body || {}, { merge: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ---------------------------------------------------------------------------
// MODULE 1 — PERSONAL CFO (money). Read-only advice; never transacts.
// ---------------------------------------------------------------------------
app.post('/api/finance/log', async (req, res) => {
  const { amount, category, note, type } = req.body || {};
  await saveDoc('finance_entries', { amount, category, note, type: type || 'expense' });
  res.json({ ok: true });
});
app.post('/api/finance/advice', async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const [profile, entries] = await Promise.all([getProfile(), recentDocs('finance_entries', 40)]);
    const extra = `[Recent finance entries]\n${JSON.stringify(entries)}\n\nAct as Aman's personal CFO. Analyze spending, flag issues, and give 3 concrete next steps. Never suggest moving money automatically.`;
    const reply = await callSonar([
      { role: 'system', content: BASE_PERSONA + buildContext(profile, [], extra) },
      { role: 'user', content: (req.body && req.body.question) || 'How am I doing financially this month?' },
    ]);
    res.json({ reply });
  } catch (e) { res.status(500).json({ reply: 'Finance module error.' }); }
});

// ---------------------------------------------------------------------------
// MODULE 2 — HEALTH & FITNESS
// ---------------------------------------------------------------------------
app.post('/api/health/log', async (req, res) => {
  const { workout, duration, notes, metric, value } = req.body || {};
  if (workout) await saveDoc('workouts', { workout, duration, notes });
  if (metric) await saveDoc('health_metrics', { metric, value });
  res.json({ ok: true });
});
app.post('/api/health/coach', async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const [profile, workouts] = await Promise.all([getProfile(), recentDocs('workouts', 20)]);
    const extra = `[Recent workouts]\n${JSON.stringify(workouts)}\n\nAct as Aman's fitness coach (Hyrox, badminton, strength). Suggest today's focus and recovery.`;
    const reply = await callSonar([
      { role: 'system', content: BASE_PERSONA + buildContext(profile, [], extra) },
      { role: 'user', content: (req.body && req.body.question) || 'What should I train today?' },
    ]);
    res.json({ reply });
  } catch (e) { res.status(500).json({ reply: 'Health module error.' }); }
});

// ---------------------------------------------------------------------------
// MODULE 3 — NUTRITION
// ---------------------------------------------------------------------------
app.post('/api/nutrition/log', async (req, res) => {
  const { meal, calories, protein, notes } = req.body || {};
  await saveDoc('nutrition_entries', { meal, calories, protein, notes });
  res.json({ ok: true });
});
app.post('/api/nutrition/plan', async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const [profile, meals] = await Promise.all([getProfile(), recentDocs('nutrition_entries', 20)]);
    const extra = `[Recent meals]\n${JSON.stringify(meals)}\n\nAct as Aman's nutrition coach. Align to his training and protein needs. Give a concrete plan.`;
    const reply = await callSonar([
      { role: 'system', content: BASE_PERSONA + buildContext(profile, [], extra) },
      { role: 'user', content: (req.body && req.body.question) || 'Plan my meals for today.' },
    ]);
    res.json({ reply });
  } catch (e) { res.status(500).json({ reply: 'Nutrition module error.' }); }
});

// ---------------------------------------------------------------------------
// MODULE 4 — IMMIGRATION + DAILY BRIEF
// ---------------------------------------------------------------------------
app.post('/api/immigration/update', async (req, res) => {
  if (!db) return res.json({ ok: false, note: 'server memory not configured' });
  try {
    await db.collection('immigration_status').doc('current').set(req.body || {}, { merge: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/immigration/ask', async (req, res) => {
  if (!requireKey(res)) return;
  try {
    let status = null;
    if (db) { const d = await db.collection('immigration_status').doc('current').get(); status = d.exists ? d.data() : null; }
    const extra = `[Immigration status]\n${JSON.stringify(status)}\n\nAct as Aman's Canadian immigration (Express Entry / CEC) tracker. Use current IRCC facts via web. Give status-aware next steps and deadlines.`;
    const reply = await callSonar([
      { role: 'system', content: BASE_PERSONA + buildContext(await getProfile(), [], extra) },
      { role: 'user', content: (req.body && req.body.question) || 'What is my next immigration step?' },
    ]);
    res.json({ reply });
  } catch (e) { res.status(500).json({ reply: 'Immigration module error.' }); }
});
app.post('/api/brief', async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const [profile, finance, workouts, meals] = await Promise.all([
      getProfile(), recentDocs('finance_entries', 10), recentDocs('workouts', 5), recentDocs('nutrition_entries', 5),
    ]);
    // Calendar events can be passed in from the frontend (which has connector access)
    const events = (req.body && req.body.events) || 'none provided';
    const extra = `[Today's calendar]\n${JSON.stringify(events)}\n[Recent finance]\n${JSON.stringify(finance)}\n[Recent workouts]\n${JSON.stringify(workouts)}\n[Recent meals]\n${JSON.stringify(meals)}\n\nWrite Aman's morning brief: one-line mood/summary, top 3 priorities, a money note, a health note, and one focus. Keep it warm and short.`;
    const reply = await callSonar([
      { role: 'system', content: BASE_PERSONA + buildContext(profile, [], extra) },
      { role: 'user', content: 'Give me my daily brief.' },
    ]);
    res.json({ reply });
  } catch (e) { res.status(500).json({ reply: 'Daily brief error.' }); }
});

// ---------------------------------------------------------------------------
// MODULE 5 — CONTENT STUDIO (Instagram posts/videos). Draft only; you approve.
// ---------------------------------------------------------------------------
app.post('/api/content/draft', async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const topic = (req.body && req.body.topic) || 'fitness + productivity';
    const format = (req.body && req.body.format) || 'reel'; // reel | carousel | post
    const extra = `Create an Instagram ${format} draft for Aman about: ${topic}.
Return: 1) a scroll-stopping hook, 2) full caption, 3) 8-12 hashtags, 4) a shot-by-shot video script (if reel) or slide text (if carousel), 5) an image/video concept prompt.
IMPORTANT: This is a DRAFT for Aman to review and approve before posting. Do not claim it is posted.`;
    const reply = await callSonar([
      { role: 'system', content: BASE_PERSONA + buildContext(await getProfile(), [], extra) },
      { role: 'user', content: `Draft a ${format} about ${topic}.` },
    ]);
    await saveDoc('content_drafts', { topic, format, draft: reply, status: 'draft' });
    res.json({ reply, note: 'Saved as DRAFT. Review and approve before posting to Instagram.' });
  } catch (e) { res.status(500).json({ reply: 'Content module error.' }); }
});
app.get('/api/content/drafts', async (req, res) => {
  const drafts = await recentDocs('content_drafts', 20);
  res.json({ drafts });
});

// ---------------------------------------------------------------------------
// MODULE 6 — INCOME STREAMS. Finds & drafts opportunities; you decide & act.
// ---------------------------------------------------------------------------
app.post('/api/income/opportunities', async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const focus = (req.body && req.body.focus) || 'consulting, freelance strategy/dev, digital products, content monetization';
    const extra = `Research realistic income opportunities for Aman (Toronto, consulting/strategy + web dev + AI skills). Focus: ${focus}.
Use live web data. Return 5 concrete opportunities, each with: type, realistic monthly potential, effort, first action Aman can take this week, and a risk note.
IMPORTANT: You never move money or transact. These are researched suggestions for Aman to evaluate and act on himself. Flag anything that looks like a scam.`;
    const reply = await callSonar([
      { role: 'system', content: BASE_PERSONA + buildContext(await getProfile(), [], extra) },
      { role: 'user', content: 'Find income opportunities for me.' },
    ]);
    await saveDoc('income_leads', { focus, result: reply, status: 'suggested' });
    res.json({ reply, note: 'These are suggestions. You decide and act — Jarvis never moves your money.' });
  } catch (e) { res.status(500).json({ reply: 'Income module error.' }); }
});

// ---------------------------------------------------------------------------
// CONTENT — approve & mark ready to post (human-in-the-loop)
// Jarvis creates content; you confirm; this marks it approved. Actual publishing
// to Instagram happens only after you connect the Instagram Graph API and approve.
// ---------------------------------------------------------------------------
app.post('/api/content/approve', async (req, res) => {
  const { draft, topic, format, decision } = req.body || {};
  const status = decision === 'approve' ? 'approved_ready_to_post' : 'rejected';
  await saveDoc('content_drafts', { draft, topic, format, status, approvedAt: new Date() });
  res.json({
    ok: true,
    status,
    note: status === 'approved_ready_to_post'
      ? 'Approved and queued. It will post once Instagram publishing is connected. Nothing posts without your approval.'
      : 'Marked as rejected. Nothing was posted.'
  });
});

// ---------------------------------------------------------------------------
// MODULE 7 — MARKETING ASSISTANT (product marketing, ad copy, campaigns)
// ---------------------------------------------------------------------------
app.post('/api/marketing/campaign', async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const product = (req.body && req.body.product) || 'a service Aman offers';
    const goal = (req.body && req.body.goal) || 'generate leads and revenue';
    const channel = (req.body && req.body.channel) || 'Instagram + Meta ads';
    const budget = (req.body && req.body.budget) || 'flexible / lean';
    const extra = `Act as Aman's marketing strategist. Product/offer: ${product}. Goal: ${goal}. Channel(s): ${channel}. Budget: ${budget}.
Deliver a ready-to-run plan: 1) target audience, 2) core message/positioning, 3) 3 ad variations (headline + primary text + CTA), 4) suggested budget split & schedule, 5) success metrics.
IMPORTANT: This is a plan for Aman to review. You do not spend money or launch ads yourself; Aman approves and launches.`;
    const reply = await callSonar([
      { role: 'system', content: BASE_PERSONA + buildContext(await getProfile(), [], extra) },
      { role: 'user', content: `Build a marketing campaign for: ${product}.` },
    ]);
    await saveDoc('marketing_campaigns', { product, goal, channel, budget, plan: reply, status: 'draft' });
    res.json({ reply, note: 'Draft campaign saved. You approve and launch ads yourself — Jarvis never spends your money.' });
  } catch (e) { res.status(500).json({ reply: 'Marketing module error.' }); }
});

// ---------------------------------------------------------------------------
// MODULE 8 — CLIENT OUTREACH / GET PROJECTS (revenue engine)
// Drafts outreach offering Aman's marketing/ad services, includes his Interac
// email for payment, and queues it for approval. Approval-gated sending only.
// ---------------------------------------------------------------------------
app.post('/api/outreach/draft', async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const profile = await getProfile();
    const interac = (req.body && req.body.interacEmail) || (profile && profile.interacEmail) || 'YOUR_INTERAC_EMAIL';
    const service = (req.body && req.body.service) || 'social media marketing & ad management';
    const target = (req.body && req.body.target) || 'local businesses that could use more customers';
    const extra = `Act as Aman's business-development assistant. Draft outreach to: ${target}, offering: ${service}.
Write: 1) a short, warm, non-spammy outreach message asking if they'd like help running ads / marketing to grow revenue, 2) a one-line value proposition, 3) a simple pricing/next-step line, 4) a polite payment note that Aman accepts Interac e-Transfer at ${interac}.
Keep it compliant with Canada's anti-spam law (CASL): identify Aman clearly, offer an easy opt-out, no misleading claims.
IMPORTANT: This is a DRAFT. Aman reviews and sends it himself (or approves sending). You never mass-send or spam.`;
    const reply = await callSonar([
      { role: 'system', content: BASE_PERSONA + buildContext(profile, [], extra) },
      { role: 'user', content: `Draft client outreach offering ${service}.` },
    ]);
    await saveDoc('outreach_drafts', { service, target, interac, draft: reply, status: 'draft' });
    res.json({ reply, note: 'Outreach draft saved. Review, then approve to send — Jarvis will not mass-send (keeps you CASL-compliant and protects your email).' });
  } catch (e) { res.status(500).json({ reply: 'Outreach module error.' }); }
});

app.post('/api/outreach/approve', async (req, res) => {
  const { draft, decision, sendTo } = req.body || {};
  const status = decision === 'approve' ? 'approved_to_send' : 'rejected';
  await saveDoc('outreach_drafts', { draft, sendTo, status, approvedAt: new Date() });
  res.json({
    ok: true, status,
    note: status === 'approved_to_send'
      ? 'Approved. Connect an email connector to send, or send it yourself. Nothing goes out without your approval.'
      : 'Rejected. Nothing was sent.'
  });
});

app.listen(PORT, () => {
  console.log(`Jarvis backend v2 running on port ${PORT} (model: ${JARVIS_MODEL})`);
});
