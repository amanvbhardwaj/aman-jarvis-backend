const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Read OpenRouter API key from environment
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Allow JSON body
app.use(express.json());

// Allow requests from your GitHub Pages origin (or other frontend)
app.use(cors({
  origin: 'https://amanvbhardwaj.github.io',
}));

// Helper: call OpenRouter chat completions API
async function callOpenRouter(prompt) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      // Optional headers for ranking; you can remove them if you like
      'HTTP-Referer': 'https://amanvbhardwaj.github.io',
      'X-OpenRouter-Title': 'Aman Jarvis',
    },
    body: JSON.stringify({
      // Use Claude Sonnet as the single Jarvis brain
      // You can use latest Sonnet:
      model: '~anthropic/claude-sonnet-latest',
      // or pin a specific version:
      // model: 'anthropic/claude-sonnet-4.6',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  const text =
    data?.choices?.[0]?.message?.content ||
    'Sorry, I could not generate a reply.';

  return text;
}

// Health check
app.get('/', (req, res) => {
  res.send('Aman Jarvis backend v3 (OpenRouter, Claude Sonnet) is running');
});

// Jarvis endpoint: now uses OpenRouter
app.post('/api/jarvis', async (req, res) => {
  try {
    const userMessage = req.body.message || '';

    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({
        reply: 'Server error: OPENROUTER_API_KEY is not set on the backend.',
      });
    }

    const reply = await callOpenRouter(userMessage);
    res.json({ reply });
  } catch (err) {
    console.error('Error in /api/jarvis:', err);
    res.status(500).json({
      reply: 'Server error: something went wrong while talking to OpenRouter.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Jarvis backend running on port ${PORT}`);
});
