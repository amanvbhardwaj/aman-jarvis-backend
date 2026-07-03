const express = require('express');
const cors = require('cors');

const app = express();
// Render will set PORT via environment; default to 10000
const PORT = process.env.PORT || 10000;

// Read Groq API key from environment
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Allow JSON body
app.use(express.json());

// Allow requests from your GitHub Pages origin (or other frontend)
app.use(cors({
  origin: 'https://amanvbhardwaj.github.io',
}));

// Helper: call Groq Llama 3 chat completions API
async function callGroq(prompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Safely extract the first text response from Groq
  const text =
    data?.choices?.[0]?.message?.content ||
    'Sorry, I could not generate a reply.';

  return text;
}

// Health check
app.get('/', (req, res) => {
  res.send('Aman Jarvis backend v2 (Groq Llama 3) is running');
});

// Jarvis endpoint: now uses Groq
app.post('/api/jarvis', async (req, res) => {
  try {
    const userMessage = req.body.message || '';

    if (!GROQ_API_KEY) {
      return res.status(500).json({
        reply: 'Server error: GROQ_API_KEY is not set on the backend.',
      });
    }

    const reply = await callGroq(userMessage);
    res.json({ reply });
  } catch (err) {
    console.error('Error in /api/jarvis:', err);
    res.status(500).json({
      reply: 'Server error: something went wrong while talking to Groq.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Jarvis backend running on port ${PORT}`);
});
