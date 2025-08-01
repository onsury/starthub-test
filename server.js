require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const { Groq } = require('groq-sdk');
const { createClient } = require('@deepgram/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize AI services
const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY,
});

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const gemini = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Configure CORS to allow your frontend
app.use(cors({
    origin: [
        'https://smartdna.netlify.app',
        'https://smart-deep-neural-assessment-dna.onrender.com',
        'http://localhost:3000',
        'http://localhost:5000'
    ],
    credentials: true
}));

app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Simple in-memory store for reports
const reportStore = {};

// Root route
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>StartHub Media AI - Backend</title>
            </head>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1>StartHub Media AI</h1>
                <h2>Organizational DNA Assessment Platform</h2>
                <p>Backend Server Running Successfully!</p>
                <p>API Endpoint: POST /api/process-interview</p>
                <p>Frontend: <a href="https://smartdna.netlify.app">https://smartdna.netlify.app</a></p>
            </body>
        </html>
    `);
});

// Helper function to transcribe with Deepgram
async function transcribeWithDeepgram(audioBuffer) {
    try {
        console.log('  - Transcribing with Deepgram...');
        
        const { result } = await deepgram.listen.prerecorded.transcribeFile(
            audioBuffer,
            {
                model: 'nova-2',
                language: 'en',
                punctuate: true,
                smart_format: true,
            }
        );
        
        const transcript = result.results.channels[0].alternatives[0].transcript;
        
        return {
            transcript: transcript,
            language: 'en',
            confidence: result.results.channels[0].alternatives[0].confidence * 100
        };
        
    } catch (error) {
        console.log('  ✗ Deepgram failed:', error.message);
        throw error;
    }
}

// Helper function to transcribe with Vapi (fallback)
async function transcribeWithVapi(audioBuffer) {
    try {
        console.log('  - Attempting transcription with Vapi...');
        // Vapi implementation would go here
        // For now, returning error as Vapi needs different setup
        throw new Error('Vapi transcription not implemented yet');
    } catch (error) {
        console.log('  ✗ Vapi failed:', error.message);
        throw error;
    }
}

// Main interview processing endpoint
app.post('/api/process-interview', upload.single('audio'), async (req, res) => {
    console.log('\n========== NEW INTERVIEW PROCESS STARTED ==========');
    console.log('Time:', new Date().toLocaleString());
    
    const startTime = Date.now();
    
    try {
        // Extract form data
        console.log('STEP 1 ✓ - Form Data Received:');
        const { founderName, companyName, email, phone, textContent, language, inputType } = req.body;
        console.log('  - Founder:', founderName);
        console.log('  - Company:', companyName);
        console.log('  - Email:', email);
        console.log('  - Input Type:', inputType || 'voice');
        
        // Initialize variables
        let transcript = '';
        let detectedLanguage = 'en';
        let englishTranscript = '';
        
        // Check if this is text input
        if (inputType === 'text' && textContent) {
            console.log('\nSTEP 2 - Processing Text Input:');
            console.log('  - Text length:', textContent.length);
            console.log('  - Selected language:', language);
            
            transcript = textContent;
            detectedLanguage = language || 'en';
            
            // Translate if not English
            if (detectedLanguage !== 'en') {
                console.log('\nSTEP 3 - Translating Text:');
                try {
                    const translationPrompt = `Translate the following ${detectedLanguage} text to English. Return only the translation, nothing else:\n\n${textContent}`;
                    const result = await gemini.generateContent(translationPrompt);
                    englishTranscript = result.response.text();
                    console.log('  ✓ Translation complete');
                } catch (error) {
                    console.log('  ⚠️ Translation failed, using original text');
                    englishTranscript = textContent;
                }
            } else {
                englishTranscript = textContent;
            }
            
        } else {
            // Process audio file
            const audioFile = req.file;
            if (!audioFile) {
                throw new Error('No audio file or text content provided');
            }
            
            console.log('STEP 2 - Checking Audio File:');
            console.log('  ✓ Audio file received');
            console.log('  - Size:', audioFile.size, 'bytes');
            console.log('  - Type:', audioFile.mimetype);
            
            const audioBuffer = audioFile.buffer;
            console.log('STEP 3 - Reading Audio File:');
            console.log('  ✓ File read successfully');
            console.log('  - Buffer size:', audioBuffer.length, 'bytes');
            
            // Transcribe audio
            console.log('\nSTEP 4 - Voice Processing:');
            let transcriptionResult;
            
            try {
                // Try Vapi first
                transcriptionResult = await transcribeWithVapi(audioBuffer);
            } catch (vapiError) {
                console.log('  ⚠️ Vapi failed, trying Deepgram...');
                try {
                    // Fall back to Deepgram
                    transcriptionResult = await transcribeWithDeepgram(audioBuffer);
                } catch (deepgramError) {
                    throw new Error('Both transcription services failed');
                }
            }
            
            transcript = transcriptionResult.transcript;
            detectedLanguage = transcriptionResult.language;
            englishTranscript = transcript; // Already in English
            
            console.log('  ✓ Transcription complete');
            console.log('  - Detected language:', detectedLanguage);
            console.log('  - Confidence:', transcriptionResult.confidence + '%');
            console.log('  - Length:', transcript.length, 'characters');
            console.log('  - Preview:', transcript.substring(0, 100) + '...');
        }
        
        // Validate transcript
        if (!transcript || transcript.length < 50) {
            throw new Error('Transcript too short - please speak for at least 30 seconds about your company');
        }
        
        // Quick insights with Groq
        console.log('\nSTEP 5 - Quick Analysis:');
        let quickInsights = '';
        
        try {
            const groqResponse = await groq.chat.completions.create({
                messages: [{
                    role: "system",
                    content: "Extract key business insights in 3 bullet points."
                }, {
                    role: "user",
                    content: englishTranscript
                }],
                model: "mixtral-8x7b-32768",
                max_tokens: 200,
            });
            
            quickInsights = groqResponse.choices[0]?.message?.content || '';
            console.log('  ✓ Quick insights generated');
        } catch (error) {
            console.log('  ⚠️ Groq failed, skipping quick insights');
        }
        
        // Deep analysis with Claude
        console.log('\nSTEP 6 - Deep Analysis:');
        console.log('  - Analyzing with Claude...');
        
        const claudeResponse = await anthropic.messages.create({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 1000,
            messages: [{
                role: "user",
                content: `Analyze this founder interview transcript and provide:
                1. Leadership DNA Pattern (2-3 sentences)
                2. Core Organizational Challenge
                3. Communication Style Assessment
                4. One Immediate Action Item
                
                Keep it concise and actionable.
                
                Transcript: ${englishTranscript}`
            }]
        });
        
        const deepAnalysis = claudeResponse.content[0].text;
        console.log('  ✓ Claude analysis complete');
        
        // Generate partial report
        const partialReport = `
ORGANIZATIONAL DNA ASSESSMENT - PRELIMINARY REPORT
================================================

Founder: ${founderName}
Company: ${companyName}
Date: ${new Date().toLocaleDateString()}
Time: ${new Date().toLocaleTimeString()}

QUICK INSIGHTS
--------------
${quickInsights || 'Processing...'}

LEADERSHIP DNA ANALYSIS
----------------------
${deepAnalysis}

NEXT STEPS
----------
This preliminary report provides initial insights into your organizational DNA. 
For a complete assessment including:
- 6 Hub Implementation Strategy
- Team Alignment Recommendations
- 90-Day Action Plan
- Customized Organizational Blueprint

Please schedule a follow-up consultation.

================================================
Processing Time: ${((Date.now() - startTime) / 1000).toFixed(2)} seconds
`;

        // Store full report
        const reportId = `RPT${Date.now()}`;
        reportStore[reportId] = {
            id: reportId,
            founderName,
            companyName,
            email,
            phone,
            transcript,
            englishTranscript,
            detectedLanguage,
            quickInsights,
            deepAnalysis,
            partialReport,
            fullReport: null,
            createdAt: new Date(),
            processingTime: Date.now() - startTime
        };
        
        console.log('\n✅ PROCESS COMPLETE!');
        console.log(`Total time: ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
        
        // Send response
        res.json({
            success: true,
            reportId,
            partialReport,
            detectedLanguage: detectedLanguage === 'en' ? 'English' : 
                             detectedLanguage === 'hi' ? 'Hindi' :
                             detectedLanguage === 'ta' ? 'Tamil' :
                             detectedLanguage === 'te' ? 'Telugu' : detectedLanguage,
            message: 'Assessment completed successfully'
        });
        
    } catch (error) {
        console.log('\n❌ ❌ ❌ FATAL ERROR ❌ ❌ ❌');
        console.log('Error Type:', error.constructor.name);
        console.log('Error Message:', error.message);
        console.log('Stack Trace:', error.stack);
        
        res.status(500).json({
            success: false,
            error: error.message || 'Processing failed',
            details: 'Please ensure you speak clearly for at least 30 seconds about your company and challenges.'
        });
    }
});

// Get report endpoint
app.get('/api/report/:reportId', (req, res) => {
    const { reportId } = req.params;
    const report = reportStore[reportId];
    
    if (!report) {
        return res.status(404).json({
            success: false,
            error: 'Report not found'
        });
    }
    
    res.json({
        success: true,
        report: report.partialReport,
        createdAt: report.createdAt
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            claude: !!process.env.CLAUDE_API_KEY,
            groq: !!process.env.GROQ_API_KEY,
            deepgram: !!process.env.DEEPGRAM_API_KEY,
            gemini: !!process.env.GEMINI_API_KEY,
            vapi: !!process.env.VAPI_API_KEY
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
    ================================================
    🚀 StartHub Media AI Server Running
    ================================================
    Port: ${PORT}
    Time: ${new Date().toLocaleString()}
    
    API Endpoints:
    - POST /api/process-interview
    - GET  /api/report/:reportId
    - GET  /api/health
    
    Frontend URL: https://smartdna.netlify.app
    ================================================
    `);
});