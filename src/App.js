import React, { useState, useRef } from 'react';
import { Upload, FileText, Search, Trash2, AlertCircle } from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

const MultimodalProcessor = () => {
  const [files, setFiles] = useState([]);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  GlobalWorkerOptions.workerSrc = `http://localhost:3000/pdf.worker.min.mjs`;

  const BACKEND_URL = 'http://localhost:5000/api/query';

  const getFileCategory = (type, name) => {
    if (type.startsWith('text/') || name.match(/\.(txt|md|pdf|docx|pptx)$/i)) return 'text';
    if (type.startsWith('image/') || name.match(/\.(png|jpg|jpeg|gif|webp)$/i)) return 'image';
    if (type.startsWith('audio/') || name.match(/\.(mp3|wav|ogg)$/i)) return 'audio';
    if (type.startsWith('video/') || name.match(/\.(mp4|webm|mov)$/i)) return 'video';
    return 'other';
  };

  const extractTextFromPdf = async (arrayBuffer) => {
    const pdf = await getDocument(arrayBuffer).promise;
    let fullText = '';
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const textContent = await page.getTextContent();
      fullText += textContent.items.map((item) => item.str).join(' ') + '\n';
    }
    return fullText;
  };

  const processFile = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target?.result ?? null;
        if (file.type === 'application/pdf') {
          const text = await extractTextFromPdf(content);
          resolve({
            id: Date.now(),
            name: file.name,
            type: file.type,
            size: file.size,
            content: text,
            category: getFileCategory(file.type, file.name),
            processedAt: new Date().toISOString(),
          });
        } else {
          resolve({
            id: Date.now(),
            name: file.name,
            type: file.type,
            size: file.size,
            content,
            category: getFileCategory(file.type, file.name),
            processedAt: new Date().toISOString(),
          });
        }
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsArrayBuffer(file);
    });
  };

  const handleFileUpload = async (e) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const uploadedFile = e.target.files[0];
    const processed = await processFile(uploadedFile);
    setFiles([processed]);
  };

  const removeFile = (id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const buildContext = (files) =>
    files.map((f) => `File: ${f.name}\nContent: ${f.content?.toString().slice(0, 1000)}...`).join('\n\n');

  const handleQuery = async () => {
    if (!query.trim()) return setError('Please enter a question');
    if (files.length === 0) return setError('Please upload at least one file');

    setError('');
    setLoading(true);
    try {
      const context = buildContext(files);
      const apiResponse = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: `Context:\n${context}\n\nQuery:\n${query}` }),
      });
      const data = await apiResponse.json();
      setResponse(data.answer || 'No response');
    } catch (err) {
      setError('Backend error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ color: 'white', backgroundColor: '#0b1120', minHeight: '100vh', padding: '2rem' }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700 }}>Multimodal Data Processing System</h1>
          <p style={{ color: '#8ab4f8' }}>Upload files, ask questions, get AI-powered answers</p>
        </div>

        {/* Upload Section */}
        <div style={{ background: 'rgba(255,255,255,0.1)', padding: 20, borderRadius: 12, marginBottom: 20 }}>
          <label
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              backgroundColor: '#2563eb',
              color: 'white',
              padding: '10px 16px',
              borderRadius: 8,
              marginBottom: 10,
            }}
          >
            <Upload style={{ width: 20, height: 20 }} />
            Upload Files
            <input type="file" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileUpload} />
          </label>

          {files.length > 0 &&
            files.map((file) => (
              <div
                key={file.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(255,255,255,0.1)',
                  padding: 10,
                  borderRadius: 8,
                  marginTop: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText style={{ width: 20, height: 20, color: '#60a5fa' }} />
                  <p>{file.name}</p>
                </div>
                <button
                  onClick={() => removeFile(file.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#f87171',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 style={{ width: 16, height: 16 }} />
                </button>
              </div>
            ))}
        </div>

        {/* Query Section */}
        <div style={{ background: 'rgba(255,255,255,0.1)', padding: 20, borderRadius: 12, marginBottom: 20 }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search style={{ width: 20, height: 20 }} /> Ask a Question
          </h2>
          <textarea
            style={{
              width: '100%',
              padding: 10,
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.3)',
              background: 'rgba(255,255,255,0.1)',
              color: 'white',
              resize: 'none',
              minHeight: 100,
            }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask anything about your uploaded files..."
          />
          <button
            onClick={handleQuery}
            disabled={loading}
            style={{
              marginTop: 12,
              width: '100%',
              padding: 10,
              background: 'linear-gradient(to right, #2563eb, #7c3aed)',
              border: 'none',
              color: 'white',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {loading ? 'Processing...' : 'Search'}
          </button>
        </div>

        {/* Response / Error */}
        {error && (
          <div
            style={{
              background: 'rgba(239,68,68,0.2)',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 12,
              padding: 10,
              marginBottom: 20,
              color: '#fca5a5',
            }}
          >
            <AlertCircle style={{ width: 16, height: 16, marginRight: 6 }} />
            {error}
          </div>
        )}

        {response && (
          <div
            style={{
              background: 'rgba(255,255,255,0.1)',
              padding: 20,
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            <h2 style={{ fontSize: '1.2rem', marginBottom: 8 }}>Response</h2>
            <p style={{ color: '#bfdbfe', whiteSpace: 'pre-wrap' }}>{response}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MultimodalProcessor;
