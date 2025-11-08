// server.js - Backend API Proxy Server
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const mongoose = require('mongoose'); // Import Mongoose
const multer = require('multer'); // Import multer
const fs = require('fs'); // Import fs
require('dotenv').config({ path: './backend/.env' }); // Load environment variables

const app = express();
const PORT = 5000;

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Files will be stored in the 'uploads' directory
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});
const upload = multer({ storage: storage });

// Ensure 'uploads' directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// MongoDB Connection
const MONGODB_URI = 'mongodb://localhost:27017/multimodal'; // Replace with your MongoDB Atlas connection string
mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB Connected...'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// Mongoose Schema for Interactions
const interactionSchema = new mongoose.Schema({
  file: {
    type: new mongoose.Schema({
      name: String,
      type: String,
      size: Number,
      category: String,
      content: String, // Storing extracted text content or link URL
      processedAt: Date,
      url: String, // New field for storing the URL if it's a link
      assemblyaiId: String, // New field for AssemblyAI transcript ID
      sentiment: String, // New field for sentiment analysis result
      summary: String, // New field for summary
    }),
    _id: false,
  },
  query: String,
  response: String,
  timestamp: { type: Date, default: Date.now },
});

const Interaction = mongoose.model('Interaction', interactionSchema);

// IMPORTANT: Replace with your actual Gemini API key
const GEMINI_API_KEY = 'AIzaSyD8tzJB0Dim89OxM-mvbs-qrjsuYbbP6l0';
const GEMINI_MODEL_ID = 'gemini-2.0-flash'; // Valid model ID
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Query endpoint - Proxy to Gemini API
app.post('/api/query', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const fileContextMatch = prompt.match(/Context from uploaded files:\n([\s\S]*?)\n\nUser Query: ([\s\S]*)/);
    let fileData = null;
    let userQuery = prompt;

    if (fileContextMatch && fileContextMatch[1] && fileContextMatch[2]) {
      const fileContentString = fileContextMatch[1];
      userQuery = fileContextMatch[2];

      const fileNameAndCategoryMatch = fileContentString.match(/File: (.*?) \((.*?)\)/);
      if (fileNameAndCategoryMatch) {
        fileData = {
          name: fileNameAndCategoryMatch[1],
          category: fileNameAndCategoryMatch[2],
          content: null, // Initialize content as null
        };

        // Extract content based on category
        if (fileData.category === 'text' && fileContentString.includes('Content:')) {
          const contentStartIndex = fileContentString.indexOf('Content:') + 'Content:'.length;
          const contentEndIndex = fileContentString.indexOf('...', contentStartIndex);
          if (contentStartIndex !== -1) {
            fileData.content = fileContentString.substring(contentStartIndex, contentEndIndex !== -1 ? contentEndIndex : fileContentString.length).trim();
          }
        } else if (fileData.category === 'image') {
          fileData.content = 'Image file uploaded (visual content available)';
        } else if (fileData.category === 'audio') {
          fileData.content = 'Audio file uploaded (auditory content available)';
        } else if (fileData.category === 'video') {
          fileData.content = 'Video file uploaded (visual and auditory content available)';
        } else {
          fileData.content = `${fileData.category} file uploaded`;
        }
      }
    }

    console.log('Received query:', userQuery.substring(0, 100) + '...');

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API Error:', errorText);
      return res.status(response.status).json({ error: 'Failed to get response from AI', details: errorText });
    }

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';

    // Save interaction to MongoDB
    const newInteraction = new Interaction({
      file: {
        ...fileData,
        assemblyaiId: fileData?.assemblyaiId || null,
        sentiment: fileData?.sentiment || null,
        summary: fileData?.summary || null,
      },
      query: userQuery,
      response: answer,
    });
    await newInteraction.save();

    console.log('Response generated successfully');
    res.json({ answer });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Helper function to poll AssemblyAI for transcription results
const pollAssemblyAI = async (transcriptId) => {
  const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;
  while (true) {
    const pollingResponse = await fetch(pollingEndpoint, {
      method: 'GET',
      headers: { 'authorization': process.env.ASSEMBLYAI_KEY },
    });
    const transcriptionResult = await pollingResponse.json();

    if (transcriptionResult.status === 'completed') {
      return transcriptionResult;
    } else if (transcriptionResult.status === 'error') {
      throw new Error(`Transcription failed: ${transcriptionResult.error}`);
    } else {
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for 3 seconds before polling again
    }
  }
};

// New endpoint for audio file uploads and transcription
app.post('/api/upload-audio', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileStream = fs.createReadStream(filePath);
    console.log('AssemblyAI Key being used:', process.env.ASSEMBLYAI_KEY);

    // Upload file to AssemblyAI
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { 'authorization': process.env.ASSEMBLYAI_KEY },
      body: fileStream
    });

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      fs.unlinkSync(filePath); // Clean up the uploaded file
      throw new Error(`Failed to upload to AssemblyAI: ${errorText}`);
    }

    const { upload_url } = await uploadRes.json();
    fs.unlinkSync(filePath); // Clean up the local uploaded file after successful upload to AssemblyAI

    // Request transcription with sentiment analysis and summarization
    const transcriptReqBody = {
      audio_url: upload_url,
      sentiment_analysis: true,
      summarization: true,
      summary_model: 'informative',
      summary_type: 'bullets'
    };

    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'authorization': process.env.ASSEMBLYAI_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(transcriptReqBody)
    });

    if (!transcriptRes.ok) {
      const errorText = await transcriptRes.text();
      throw new Error(`Failed to request transcription: ${errorText}`);
    }

    const transcriptData = await transcriptRes.json();

    // Poll for the transcription result
    const completedTranscript = await pollAssemblyAI(transcriptData.id);

    res.json({
      id: completedTranscript.id,
      text: completedTranscript.text,
      sentiment_analysis_results: completedTranscript.sentiment_analysis_results,
      summary: completedTranscript.summary,
    });
  } catch (error) {
    console.error('Error processing audio upload:', error);
    res.status(500).json({ error: 'Failed to process audio', message: error.message });
  }
});

// New endpoint for YouTube video transcription and summarization
app.post('/api/process-youtube', async (req, res) => {
  try {
    const { youtubeUrl } = req.body;
    if (!youtubeUrl) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    // Request transcription with sentiment analysis and summarization for YouTube video
    const transcriptReqBody = {
      audio_url: youtubeUrl,
      sentiment_analysis: true,
      summarization: true,
      summary_model: 'informative',
      summary_type: 'bullets'
    };

    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'authorization': process.env.ASSEMBLYAI_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(transcriptReqBody)
    });

    if (!transcriptRes.ok) {
      const errorText = await transcriptRes.text();
      throw new Error(`Failed to request YouTube transcription: ${errorText}`);
    }

    const transcriptData = await transcriptRes.json();

    // Poll for the transcription result
    const completedTranscript = await pollAssemblyAI(transcriptData.id);

    res.json({
      id: completedTranscript.id,
      text: completedTranscript.text,
      sentiment_analysis_results: completedTranscript.sentiment_analysis_results,
      summary: completedTranscript.summary,
    });
  } catch (error) {
    console.error('Error processing YouTube video:', error);
    res.status(500).json({ error: 'Failed to process YouTube video', message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api/query`);
  console.log(`📡 Audio Upload endpoint: http://localhost:${PORT}/api/upload-audio`);
  console.log(`📡 YouTube Process endpoint: http://localhost:${PORT}/api/process-youtube`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
});