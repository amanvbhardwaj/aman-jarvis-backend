const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Read Perplexity Sonar API key from environment (set this in Render, NOT in code)
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// Which Sonar model to use as Jarvis's brain.
// Options: 'sonar' (fast, cheap), 'sonar-pro' (smarter, web-grounded), 'sonar-reasoning'
const JARVIS_MODEL = process.env.JARVIS_MODEL || 'sonar-pro';

// Jarvis's personality + role. This shapes every reply.
const SYSTEM_PROMPT = `You are Jarvis, the personal life operating system for Aman Bhardwaj.
Aman lives in Toronto, works in consulting, is into fitness (Hyrox, badminton, strength training),
is navigating Canadian immigration (Express Entry / CEC), and cares about personal finance,
health, nutrition, and building things with technology.

Your role: be a warm, sharp, practical companion and personal CFO + health coach + planner.
- Be concise and direct. Lead with the answer, then a short reason.
- When money, health, or nutrition come up, give specific, actionable next steps.
- Ask at most one clarifying question only when truly needed.
- You have live web access via Sonar, so use current facts when relevant and cite them briefly.
- Speak in a friendly, calm, encouraging tone. You are Aman's Jarvis.`;

// Allow JSON body
app.use(express.json());

// Allow requests from the GitHub Pages frontend
app.use(cors({
  origin: 'https://amanvbhardwaj.github.io',
}));

// Ensure fetch exists (Node 18+ has it global; fall back to node-fetch otherwise)
const fetchFn = (typeof fetch !== 'undefined')
  ? fetch
  : ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

// Helper: call Perplexity Sonar chat completions API
async function callPerplexity(userMessage) {
  const response = await fetchFn('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      model: JARVIS_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Perplexity API error: ${response.status} ${response.statusText} ${detail}`);
  }

  const data = await response.json();

  const text =
    data?.choices?.[0]?.message?.content ||
    'Sorry, I could not generate a reply.';

  return text;
}

// Health check
app.get('/', (req, res) => {
  res.send('Aman Jarvis backend v4 (Perplexity Sonar) is running');
});

// Jarvis endpoint: now uses Perplexity Sonar
app.post('/api/jarvis', async (req, res) => {
  try {
    const userMessage = req.body.message || '';

    if (!PERPLEXITY_API_KEY) {
      return res.status(500).json({
        reply: 'Server error: PERPLEXITY_API_KEY is not set on the backend.',
      });
    }

    const reply = await callPerplexity(userMessage);
    res.json({ reply });
  } catch (err) {
    console.error('Error in /api/jarvis:', err);
    res.status(500).json({
      reply: 'Server error: something went wrong while talking to Perplexity Sonar.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Jarvis backend (Perplexity Sonar) running on port ${PORT}`);
});
