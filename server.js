// server.js - COMPLETE FILE - Replace your entire server.js with this
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const fs = require('fs');

// Import official SDKs
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const upload = multer({ dest: 'uploads/' });

// IMPORTANT: Allow requests from your Netlify frontend
app.use(cors({
  origin: ['https://smartdna.netlify.app', 'http://localhost:3000', 'http://localhost:5000'],
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// DO NOT serve static files - remove this line if it exists
// app.use(express.static('public'));

// Initialize SDKs
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY, // Changed from CLAUDE_API_KEY
});

// ============== Sarvam AI Integration ==============
class SarvamService {
  constructor() {
    this.apiKey = process.env.SARVAM_API_KEY;
    this.baseURL = 'https://api.sarvam.ai';
  }

  async transcribeAudio(audioFilePath, language = 'hi-IN') {
    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(audioFilePath));
      formData.append('language_code', language);
      
      const response = await axios.post(
        `${this.baseURL}/speech-to-text`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'API-Subscription-Key': this.apiKey
          }
        }
      );
      
      return response.data.transcript;
    } catch (error) {
      console.error('Sarvam STT Error:', error.response?.data || error.message);
      throw error;
    }
  }
}

// ============== OpenRouter Integration ==============
class OpenRouterService {
  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.baseURL = 'https://openrouter.ai/api/v1';
  }

  async callSarvamM(prompt, language = 'hi') {
    try {
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: 'sarvamai/sarvam-2b-v0.5', // Update with exact model name from OpenRouter
          messages: [
            {
              role: 'system',
              content: `You are an AI assistant specialized in Indian business culture and languages. 
                       Understand context about family businesses, joint families, tier-2/3 cities, 
                       and Indian entrepreneurship. Respond thoughtfully considering Indian cultural nuances.`
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 1500
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://smartdna.netlify.app',
            'X-Title': 'StartHub AI Assessment'
          }
        }
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('OpenRouter Error:', error.response?.data || error.message);
      throw error;
    }
  }
}

// ============== Gemini Integration ==============
async function callGemini(prompt) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini Error:', error);
    throw error;
  }
}

// ============== Claude Integration ==============
async function callClaude(prompt) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });
    
    return message.content[0].text;
  } catch (error) {
    console.error('Claude Error:', error);
    throw error;
  }
}

// Initialize services
const sarvam = new SarvamService();
const openRouter = new OpenRouterService();

// ============== Main Assessment Endpoint ==============
app.post('/api/assess', upload.single('audio'), async (req, res) => {
  let audioPath = null;
  
  try {
    const { language = 'hi-IN', textInput, mode = 'voice' } = req.body;
    let transcribedText = textInput;
    
    // Step 1: Handle Voice Input
    if (mode === 'voice' && req.file) {
      audioPath = req.file.path;
      console.log('Transcribing audio with Sarvam...');
      transcribedText = await sarvam.transcribeAudio(audioPath, language);
      console.log('Transcription:', transcribedText);
    }
    
    if (!transcribedText) {
      throw new Error('No input provided');
    }
    
    // Step 2: Process with Multi-LLM System
    console.log('Processing with AI pipeline...');
    
    // Sarvam-M Analysis (Indian Context)
    const sarvamAnalysis = await openRouter.callSarvamM(`
      Analyze this business assessment response considering Indian context:
      "${transcribedText}"
      
      Focus on:
      1. Business potential in Indian market
      2. Cultural and family dynamics
      3. Challenges specific to Indian entrepreneurs
      4. Growth opportunities
    `, language);
    
    // Gemini Analysis (General Business)
    const geminiAnalysis = await callGemini(`
      Provide business analysis for: "${transcribedText}"
      Focus on market potential, scalability, and innovation.
    `);
    
    // Claude Orchestration (Final Report)
    const finalReport = await callClaude(`
      Create a comprehensive business assessment report by combining these analyses:
      
      Indian Market Context Analysis:
      ${sarvamAnalysis}
      
      Global Business Perspective:
      ${geminiAnalysis}
      
      Original Response: "${transcribedText}"
      
      Structure the report with:
      1. Executive Summary
      2. Strengths Analysis
      3. Growth Opportunities
      4. Challenges & Solutions
      5. Action Plan
      6. Next Steps
      
      Make it professional yet accessible.
    `);
    
    // Send Response
    res.json({
      success: true,
      report: finalReport,
      processedBy: 'StartHub AI Deep Neural Assessment',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Assessment Error:', error);
    res.status(500).json({
      success: false,
      error: 'Assessment processing failed. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    // Cleanup uploaded file
    if (audioPath && fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  }
});

// ============== Test Endpoints ==============
app.get('/api/test', async (req, res) => {
  res.json({
    status: 'StartHub AI Multi-LLM System Active',
    services: {
      sarvam: !!process.env.SARVAM_API_KEY,
      openRouter: !!process.env.OPENROUTER_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY // Changed from CLAUDE_API_KEY
    },
    version: '2.0',
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Root endpoint - DO NOT serve HTML here
app.get('/', (req, res) => {
  res.json({
    message: 'StartHub AI Assessment API',
    frontend: 'https://smartdna.netlify.app',
    endpoints: {
      test: 'GET /api/test',
      assess: 'POST /api/assess',
      health: 'GET /health'
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`StartHub AI Server running on port ${PORT}`);
  console.log('Services configured:', {
    sarvam: !!process.env.SARVAM_API_KEY,
    openRouter: !!process.env.OPENROUTER_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY // Changed from CLAUDE_API_KEY
  });
});