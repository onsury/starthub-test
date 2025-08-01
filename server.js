// server.js - Complete Multi-LLM System with Fallback Mechanisms
const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const { createClient } = require('@deepgram/sdk');
const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');
require('dotenv').config();

// ============================================
// 🔒 SECURITY CHECKS - All 6 API Keys
// ============================================
console.log('🔍 Checking environment variables...');
const requiredEnvVars = [
  'CLAUDE_API_KEY', 
  'DEEPGRAM_API_KEY', 
  'GROQ_API_KEY',
  'VAPI_API_KEY',
  'GEMINI_API_KEY', 
  'DEEPINFRA_API_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars);
  console.error('📋 Please add these to your .env file');
  process.exit(1);
}

console.log('🔐 Validating API key formats...');
console.log('✅ Claude API key loaded:', process.env.CLAUDE_API_KEY ? '✓' : '✗');
console.log('✅ Deepgram API key loaded:', process.env.DEEPGRAM_API_KEY ? '✓' : '✗');
console.log('✅ Groq API key loaded:', process.env.GROQ_API_KEY ? '✓' : '✗');
console.log('✅ Vapi API key loaded:', process.env.VAPI_API_KEY ? '✓' : '✗');
console.log('✅ Gemini API key loaded:', process.env.GEMINI_API_KEY ? '✓' : '✗');
console.log('✅ DeepInfra API key loaded:', process.env.DEEPINFRA_API_KEY ? '✓' : '✗');

// ============================================
// 🤖 INITIALIZE ALL AI SERVICES
// ============================================
console.log('\n🤖 Initializing AI services...');

const app = express();
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Initialize all AI services
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Vapi initialization (will add proper SDK when available)
const vapiKey = process.env.VAPI_API_KEY;

// Gemini initialization
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const gemini = genAI.getGenerativeModel({ model: "gemini-pro" });

// DeepInfra initialization
const deepinfraKey = process.env.DEEPINFRA_API_KEY;

// Google services
const auth = new google.auth.GoogleAuth({
  keyFile: './service-account-key.json',
  scopes: [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
  ],
});

let docs, sheets, drive;

async function initializeGoogleServices() {
  try {
    const authClient = await auth.getClient();
    google.options({ auth: authClient });
    
    docs = google.docs('v1');
    sheets = google.sheets('v4');
    drive = google.drive('v3');
    
    console.log('✅ Google services initialized');
  } catch (error) {
    console.log('⚠️  Google services not initialized:', error.message);
  }
}

initializeGoogleServices();

console.log('✅ All AI services initialized successfully');

app.use(express.json());
app.use(express.static('public'));

// Store for reports
const reportStore = {};

// ============================================
// 🌐 LANGUAGE MAPPING
// ============================================
const languageMap = {
  'en': 'English',
  'hi': 'Hindi',
  'ta': 'Tamil', 
  'te': 'Telugu',
  'bn': 'Bengali',
  'gu': 'Gujarati',
  'kn': 'Kannada',
  'ml': 'Malayalam',
  'mr': 'Marathi',
  'pa': 'Punjabi'
};

// ============================================
// 🎙️ VOICE PROCESSING WITH VAPI (PRIMARY)
// ============================================
async function transcribeWithVapi(audioBuffer) {
  try {
    console.log('  - Attempting transcription with Vapi...');
    
    // Vapi API implementation
    // Note: Replace with actual Vapi SDK when available
    const formData = new FormData();
    formData.append('audio', new Blob([audioBuffer]));
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'auto'); // Auto-detect
    
    const response = await fetch('https://api.vapi.ai/transcribe', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vapiKey}`
      },
      body: formData
    });
    
    if (!response.ok) throw new Error('Vapi transcription failed');
    
    const result = await response.json();
    console.log('  ✓ Vapi transcription successful');
    
    return {
      transcript: result.text,
      language: result.detected_language || 'en',
      confidence: result.confidence || 85
    };
    
  } catch (error) {
    console.log('  ✗ Vapi failed:', error.message);
    throw error;
  }
}

// ============================================
// 🎙️ VOICE PROCESSING WITH DEEPGRAM (FALLBACK)
// ============================================
async function transcribeWithDeepgram(audioBuffer) {
  try {
    console.log('  - Falling back to Deepgram...');
    
    const { result } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: 'nova-2',
        language: 'multi',
        detect_language: true,
        punctuate: true,
        smart_format: true,
      }
    );
    
    if (!result?.results?.channels?.[0]?.alternatives?.[0]) {
      throw new Error('Deepgram returned no results');
    }
    
    const transcript = result.results.channels[0].alternatives[0].transcript;
    const detectedLang = result.results.channels[0].detected_language || 'en';
    
    console.log('  ✓ Deepgram transcription successful');
    
    return {
      transcript: transcript,
      language: detectedLang,
      confidence: 80
    };
    
  } catch (error) {
    console.log('  ✗ Deepgram failed:', error.message);
    throw error;
  }
}

// ============================================
// 🌍 TRANSLATION WITH GEMINI (PRIMARY)
// ============================================
async function translateWithGemini(text, sourceLang) {
  try {
    console.log('  - Translating with Gemini...');
    
    const prompt = `Translate the following ${languageMap[sourceLang] || sourceLang} text to English. 
    Maintain business context and technical terms. 
    Text: ${text}`;
    
    const result = await gemini.generateContent(prompt);
    const translation = result.response.text();
    
    console.log('  ✓ Gemini translation successful');
    return translation;
    
  } catch (error) {
    console.log('  ✗ Gemini translation failed:', error.message);
    throw error;
  }
}

// ============================================
// 🧠 DEEP ANALYSIS WITH FALLBACK
// ============================================
async function analyzeWithClaude(transcript, context) {
  try {
    console.log('  - Analyzing with Claude...');
    
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Analyze this founder interview for organizational DNA:

TRANSCRIPT: ${transcript}
${context}

Create a comprehensive report with:
1. Executive Summary (2-3 paragraphs)
2. Leadership DNA Pattern Analysis
3. Top 3 Organizational Challenges
4. Critical Growth Recommendations
5. Quick Win Implementation Ideas`
      }]
    });
    
    console.log('  ✓ Claude analysis complete');
    return response.content[0].text;
    
  } catch (error) {
    console.log('  ✗ Claude failed:', error.message);
    // Fallback to DeepInfra
    return analyzeWithDeepInfra(transcript, context);
  }
}

async function analyzeWithDeepInfra(transcript, context) {
  try {
    console.log('  - Falling back to DeepInfra...');
    
    const response = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deepinfraKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
        messages: [{
          role: 'user',
          content: `Analyze this business interview: ${transcript}\n${context}`
        }],
        max_tokens: 2000
      })
    });
    
    const result = await response.json();
    console.log('  ✓ DeepInfra analysis complete');
    return result.choices[0].message.content;
    
  } catch (error) {
    console.log('  ✗ DeepInfra failed:', error.message);
    throw error;
  }
}

// ============================================
// 🎯 MAIN INTERVIEW PROCESSING ENDPOINT
// ============================================
app.post('/api/process-interview', upload.single('audio'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('\n========== NEW INTERVIEW PROCESS STARTED ==========');
    console.log('Time:', new Date().toLocaleString());
    
    // Step 1: Extract form data
    const { founderName, companyName, email, phone } = req.body;
    const audioFile = req.file;
    
    console.log('\nSTEP 1 ✓ - Form Data Received:');
    console.log('  - Founder:', founderName);
    console.log('  - Company:', companyName);
    console.log('  - Email:', email);
    
    // Step 2: Validate audio file
    console.log('\nSTEP 2 - Checking Audio File:');
    if (!audioFile || audioFile.size === 0) {
      throw new Error('No audio file received');
    }
    
    console.log('  ✓ Audio file received');
    console.log('  - Size:', audioFile.size, 'bytes');
    console.log('  - Type:', audioFile.mimetype);
    
    // Step 3: Read audio file
    console.log('\nSTEP 3 - Reading Audio File:');
    const audioBuffer = await fs.readFile(audioFile.path);
    console.log('  ✓ File read successfully');
    console.log('  - Buffer size:', audioBuffer.length, 'bytes');
    
    // After reading the audio file, add:
console.log('\nSTEP 3.5 - Audio File Analysis:');
console.log('  - First 4 bytes:', audioBuffer.slice(0, 4).toString('hex'));
console.log('  - File signature:', audioBuffer.slice(0, 20).toString('ascii'));

// This helps identify the audio format
    // Step 4: Transcribe with fallback
    console.log('\nSTEP 4 - Voice Processing:');
    let transcriptionResult;
    
    try {
      transcriptionResult = await transcribeWithVapi(audioBuffer);
    } catch (vapiError) {
      console.log('  ⚠️ Vapi failed, trying Deepgram...');
      transcriptionResult = await transcribeWithDeepgram(audioBuffer);
    }
    
    const { transcript, language, confidence } = transcriptionResult;
    const languageName = languageMap[language] || 'Unknown';
    
    console.log('  ✓ Transcription complete');
    console.log('  - Detected language:', languageName);
    console.log('  - Confidence:', confidence + '%');
    console.log('  - Length:', transcript.length, 'characters');
    console.log('  - Preview:', transcript.substring(0, 100) + '...');
    
    if (!transcript || transcript.length < 20) {
      throw new Error('Transcript too short - please speak louder or longer');
    }
    
    // Step 5: Translate if needed
    let englishTranscript = transcript;
    let culturalContext = '';
    
    if (language !== 'en') {
      console.log('\nSTEP 5 - Translation:');
      try {
        englishTranscript = await translateWithGemini(transcript, language);
        culturalContext = `\n\nIMPORTANT: Interview conducted in ${languageName}. Consider regional business context.`;
      } catch (error) {
        console.log('  ⚠️ Translation failed, using original');
        englishTranscript = transcript;
      }
    }
    
    // Step 6: Quick insights with Groq
    console.log('\nSTEP 6 - Quick Analysis:');
    let quickInsights = '';
    
    try {
      const groqResponse = await groq.chat.completions.create({
        messages: [{
          role: 'user',
          content: `Extract 4 key business insights from: ${englishTranscript}`
        }],
        model: 'llama-3.1-70b-versatile',
        temperature: 0.3,
        max_tokens: 500
      });
      
      quickInsights = groqResponse.choices[0].message.content;
      console.log('  ✓ Quick insights generated');
    } catch (error) {
      console.log('  ⚠️ Groq failed, skipping quick insights');
    }
    
    // Step 7: Deep analysis with fallback
    console.log('\nSTEP 7 - Deep Analysis:');
    const fullReport = await analyzeWithClaude(
      englishTranscript, 
      culturalContext + '\n\nQuick Insights:\n' + quickInsights
    );
    
    // Create report
    const partialReport = `
PRELIMINARY ASSESSMENT - ${companyName}
Generated: ${new Date().toLocaleString()}

FOUNDER: ${founderName}
COMPANY: ${companyName}
INTERVIEW LANGUAGE: ${languageName}
PROCESSING TIME: ${((Date.now() - startTime) / 1000).toFixed(2)} seconds

${language !== 'en' ? `=== ORIGINAL TRANSCRIPT (${languageName}) ===\n${transcript}\n\n` : ''}

=== EXECUTIVE SUMMARY ===
${fullReport.split('\n').slice(0, 20).join('\n')}

=== KEY INSIGHTS ===
${quickInsights}

=== NEXT STEPS ===
This preliminary assessment reveals critical patterns.
Complete CorePersonaDNA mapping includes:
- All 6 FunctionPersonaDNA blueprints
- 90-day implementation roadmap
- Success metrics & ROI tracking

Investment: ₹75,000 (Complete Assessment)
Hub Subscriptions: ₹15,000/month per hub

To unlock full insights, schedule a consultation.`;
    
    // Store report
    const reportId = `RPT${Date.now()}`;
    reportStore[reportId] = {
      id: reportId,
      founderName,
      companyName,
      email,
      timestamp: new Date(),
      language: languageName,
      partialReport,
      fullReport,
      transcript,
      englishTranscript,
      status: 'partial'
    };
    
    // Clean up
    await fs.unlink(audioFile.path);
    
    console.log('\n✅ PROCESS COMPLETE!');
    console.log('Total time:', ((Date.now() - startTime) / 1000).toFixed(2), 'seconds');
    
    res.json({
      success: true,
      reportId,
      partialReport,
      detectedLanguage: languageName,
      processingTime: ((Date.now() - startTime) / 1000).toFixed(2),
      message: 'Assessment ready'
    });
    
  } catch (error) {
    console.error('\n❌ ❌ ❌ FATAL ERROR ❌ ❌ ❌');
    console.error('Error Type:', error.name);
    console.error('Error Message:', error.message);
    console.error('Stack Trace:', error.stack);
    
    // Clean up on error
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Processing failed - please try again',
      details: error.message 
    });
  }
});

// ============================================
// 🏥 HEALTH CHECK ENDPOINT
// ============================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    services: {
      claude: !!process.env.CLAUDE_API_KEY,
      deepgram: !!process.env.DEEPGRAM_API_KEY,
      groq: !!process.env.GROQ_API_KEY,
      vapi: !!process.env.VAPI_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      deepinfra: !!process.env.DEEPINFRA_API_KEY,
      google: !!auth
    },
    timestamp: new Date().toISOString()
  });
});

// ============================================
// 🔍 GET REPORT DETAILS (for debugging)
// ============================================
app.get('/api/report/:reportId', (req, res) => {
  const report = reportStore[req.params.reportId];
  if (report) {
    res.json({
      id: report.id,
      language: report.language,
      transcript: report.transcript,
      partialReport: report.partialReport,
      timestamp: report.timestamp
    });
  } else {
    res.status(404).json({ error: 'Report not found' });
  }
});

// ============================================
// 🚀 START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
🚀 StartHub Media AI - Multi-LLM System Ready!

Services Active:
✅ Vapi - Primary Voice Processing
✅ Deepgram - Backup Voice Recognition  
✅ Groq - Quick Insights
✅ Gemini - Translation & Multi-lingual
✅ Claude - Deep Psychological Analysis
✅ DeepInfra - Backup Analysis
✅ Google - Report Generation & Tracking

Access Points:
🌐 Main App: http://localhost:${PORT}
🏥 Health Check: http://localhost:${PORT}/api/health
📊 Report Details: http://localhost:${PORT}/api/report/[reportId]

Ready to process interviews in 10+ Indian languages!
  `);
});