const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Read Gemini API key from environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Allow JSON body
app.use(express.json());

// Allow requests from your GitHub Pages origin
app.use(cors({
  origin: 'https://amanvbhardwaj.github.io',
}));

// Helper: call Gemini generateContent API
async function callGemini(prompt) {
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

  const response = await fetch(`${endpoint}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt }
          ]
        }
      ]
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Safely extract the first text response from Gemini
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    'Sorry, I could not generate a reply.';

  return text;
}

// Health check
app.get('/', (req, res) => {
  res.send('Aman Jarvis backend v1 (Gemini) is running');
});

// Jarvis endpoint: now uses Gemini
app.post('/api/jarvis', async (req, res) => {
  try {
    const userMessage = req.body.message || '';

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        reply: 'Server error: GEMINI_API_KEY is not set on the backend.',
      });
    }

    const reply = await callGemini(userMessage);
    res.json({ reply });
  } catch (err) {
    console.error('Error in /api/jarvis:', err);
    res.status(500).json({
      reply: 'Server error: something went wrong while talking to Gemini.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Jarvis backend running on port ${PORT}`);
});
