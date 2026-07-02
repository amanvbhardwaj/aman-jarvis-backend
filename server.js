const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow JSON body
app.use(express.json());

// Allow requests from your GitHub Pages origin
app.use(cors({
  origin: 'https://amanvbhardwaj.github.io',
}));

// Health check
app.get('/', (req, res) => {
  res.send('Aman Jarvis backend v0 is running');
});

// Jarvis endpoint (no AI yet)
app.post('/api/jarvis', (req, res) => {
  const userMessage = req.body.message || '';

  // Placeholder reply for now
  const reply = `Backend v0 received: "${userMessage}". Next step: connect Gemini here.`;

  res.json({ reply });
});

app.listen(PORT, () => {
  console.log(`Jarvis backend running on port ${PORT}`);
});
