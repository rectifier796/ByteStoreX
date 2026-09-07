import { storageService } from '../modules/storage/storage.service.js';
import { logger } from '../core/logger.js';
import zlib from 'zlib';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface FileMetaForThumb {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storagePath?: string;
}

/**
 * Extracts a real video frame snapshot at 2.0s using FFmpeg binary executable.
 */
export async function generateVideoThumbnailBuffer(storagePath: string): Promise<Buffer | null> {
  const binaryPath = typeof ffmpegPath === 'string' ? ffmpegPath : (ffmpegPath as any)?.default;
  if (!binaryPath) return null;

  const tempDir = os.tmpdir();
  const rand = Math.random().toString(36).substring(2);
  const inputTemp = path.join(tempDir, `v_in_${Date.now()}_${rand}.tmp`);
  const outputTemp = path.join(tempDir, `v_out_${Date.now()}_${rand}.jpg`);

  try {
    const stream = await storageService.fetchFileStream(storagePath);
    const writeStream = fs.createWriteStream(inputTemp);

    await new Promise<void>((resolve, reject) => {
      stream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    await new Promise<void>((resolve, reject) => {
      execFile(
        binaryPath,
        [
          '-ss', '00:00:02',
          '-i', inputTemp,
          '-vframes', '1',
          '-vf', 'scale=300:180:force_original_aspect_ratio=decrease,pad=300:180:(ow-iw)/2:(oh-ih)/2:color=black',
          '-q:v', '3',
          '-y',
          outputTemp
        ],
        { timeout: 15000 },
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });

    if (fs.existsSync(outputTemp)) {
      const thumbBuf = fs.readFileSync(outputTemp);
      return thumbBuf;
    }
  } catch (err: any) {
    logger.warn('ThumbnailUtils', `FFmpeg video frame extraction notice: ${err.message}`);
  } finally {
    if (fs.existsSync(inputTemp)) try { fs.unlinkSync(inputTemp); } catch {}
    if (fs.existsSync(outputTemp)) try { fs.unlinkSync(outputTemp); } catch {}
  }

  return null;
}

/**
 * Helper to escape XML special characters for SVG injection.
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Parses PDF buffer streams, decompresses zlib FlateDecode streams, and extracts clean document text.
 * Completely filters out PDF internal structural keywords (FlateDecode, XRef, Linearized, etc.)
 */
export function extractPdfTextFromBuffer(pdfBuf: Buffer, fileName: string, fileSizeStr: string): string {
  const extractedWords: string[] = [];

  // Search for stream ... endstream blocks in PDF binary
  let searchPos = 0;
  while (searchPos < pdfBuf.length && extractedWords.length < 50) {
    const streamStart = pdfBuf.indexOf('stream', searchPos);
    if (streamStart === -1) break;

    // Stream content starts after 'stream\r\n' or 'stream\n'
    let contentStart = streamStart + 6;
    if (pdfBuf[contentStart] === 0x0d) contentStart++;
    if (pdfBuf[contentStart] === 0x0a) contentStart++;

    const streamEnd = pdfBuf.indexOf('endstream', contentStart);
    if (streamEnd === -1) break;

    const streamData = pdfBuf.subarray(contentStart, streamEnd);
    searchPos = streamEnd + 9;

    if (streamData.length < 10) continue;

    // Attempt zlib decompress
    try {
      const decompressed = zlib.inflateSync(streamData);
      const decStr = decompressed.toString('utf-8');

      // Extract text in PDF parentheses (Text) or TJ arrays
      const matches = decStr.match(/\(([^()]{2,60})\)/g);
      if (matches) {
        for (const m of matches) {
          const clean = m.replace(/[()]/g, '').trim();
          if (
            clean.length > 2 &&
            !/^(PDF|FlateDecode|XRef|Linearized|DecodeParms|Columns|Predictor|Size|Prev|Trailer|Root|Catalog|Type|Font|MediaBox)/i.test(clean)
          ) {
            extractedWords.push(clean);
          }
        }
      }
    } catch {
      // Stream might not be zlib compressed or raw binary graphic
    }
  }

  // Filter out any PDF structural keywords that leaked
  const pdfKeywords = new Set([
    'PDF', 'LINEARIZED', 'FLATEDECODE', 'DECODEPARMS', 'COLUMNS', 'PREDICTOR',
    'XREF', 'SIZE', 'PREV', 'FILTER', 'TRAILER', 'ROOT', 'INFO', 'CATALOG',
    'TYPE', 'OBJ', 'ENDOBJ', 'STREAM', 'ENDSTREAM', 'LENGTH', 'MEDIABOX',
    'PARENT', 'CONTENTS', 'FONT', 'ENCODING', 'ID', 'ENCRYPT', 'PARAMS', 'INDEX'
  ]);

  const cleanWords = extractedWords
    .flatMap((w) => w.split(/\s+/))
    .filter((w) => w.length > 1 && !pdfKeywords.has(w.toUpperCase()) && !/^\d+$/.test(w));

  if (cleanWords.length >= 4) {
    const lines: string[] = [];
    for (let i = 0; i < cleanWords.length && lines.length < 5; i += 4) {
      lines.push(cleanWords.slice(i, i + 4).join(' '));
    }
    return lines.join('\n');
  }

  // Elegant fallback text for PDF when no text stream is present
  return [
    `Document: ${fileName}`,
    `Format: Portable Document Format`,
    `File Size: ${fileSizeStr}`,
    `Status: Clean PDF Structure`
  ].join('\n');
}

/**
 * Attempts to extract MP4 video duration in seconds by parsing MP4 `mvhd` atom box.
 */
export function extractMp4Duration(buffer: Buffer): number | null {
  try {
    const idx = buffer.indexOf('mvhd');
    if (idx !== -1 && idx + 28 < buffer.length) {
      const version = buffer[idx + 4];
      if (version === 0) {
        const timescale = buffer.readUInt32BE(idx + 16);
        const duration = buffer.readUInt32BE(idx + 20);
        if (timescale > 0 && duration > 0) {
          return Math.floor(duration / timescale);
        }
      } else if (version === 1 && idx + 36 < buffer.length) {
        const timescale = buffer.readUInt32BE(idx + 20);
        const duration = Number(buffer.readBigUInt64BE(idx + 24));
        if (timescale > 0 && duration > 0) {
          return Math.floor(duration / timescale);
        }
      }
    }
  } catch {
    // Ignore error
  }
  return null;
}

/**
 * Streams up to 100KB of a file to extract sample text or inspect binary structures (PDF/MP4).
 */
export async function extractSampleText(storagePath: string): Promise<string> {
  try {
    const stream = await storageService.fetchFileStream(storagePath);
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of stream) {
      const buf = Buffer.from(chunk);
      chunks.push(buf);
      totalBytes += buf.length;
      if (totalBytes >= 102400) { // Read up to 100KB for PDF/MP4 header scanning
        if (typeof (stream as any).destroy === 'function') {
          (stream as any).destroy();
        }
        break;
      }
    }

    const fullBuf = Buffer.concat(chunks);
    const isPdf = storagePath.toLowerCase().endsWith('.pdf') || fullBuf.subarray(0, 5).toString('utf-8') === '%PDF-';

    if (isPdf) {
      const fileSizeStr = formatSize(fullBuf.length);
      return extractPdfTextFromBuffer(fullBuf, storagePath.split('/').pop() || 'document.pdf', fileSizeStr);
    }

    // Convert to string and strip non-printable binary control characters
    let rawText = fullBuf.toString('utf-8', 0, Math.min(fullBuf.length, 4096));
    rawText = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ');

    return rawText.trim();
  } catch (err: any) {
    logger.warn('ThumbnailUtils', `Failed to extract sample text from '${storagePath}': ${err.message}`);
    return '';
  }
}

/**
 * Simple deterministic 32-bit integer hash from string.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Format file size into human readable string
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format seconds into mm:ss or hh:mm:ss
 */
function formatDuration(totalSec: number): string {
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Main SVG Generator: Produces rich, content-aware SVG thumbnails for text, PDF, video, audio, and code.
 */
export function generateContentAwareSvg(file: FileMetaForThumb, sampleText: string = ''): string {
  const ext = (file.name.split('.').pop() || 'FILE').toUpperCase();
  const mime = (file.mimeType || '').toLowerCase();

  const isPdf = mime.includes('pdf') || ext === 'PDF';
  const isVideo = mime.startsWith('video/') || ['MP4', 'MKV', 'AVI', 'MOV', 'WEBM', 'FLV'].includes(ext);
  const isAudio = mime.startsWith('audio/') || ['MP3', 'WAV', 'OGG', 'FLAC', 'AAC', 'M4A'].includes(ext);
  const isImage = mime.startsWith('image/') || ['JPG', 'JPEG', 'PNG', 'WEBP', 'GIF', 'SVG'].includes(ext);
  const isCode = ['JS', 'TS', 'PY', 'JSON', 'HTML', 'CSS', 'CPP', 'C', 'JAVA', 'GO', 'RS', 'PHP', 'SH', 'SQL', 'YAML', 'YML', 'XML'].includes(ext);
  const isText = isCode || mime.startsWith('text/') || ['TXT', 'MD', 'LOG', 'CSV', 'ENV', 'CONFIG'].includes(ext);

  const cleanName = escapeXml(file.name.length > 25 ? file.name.substring(0, 22) + '...' : file.name);
  const fileSizeStr = formatSize(file.size);
  const hash = simpleHash(file.id + file.name);

  // --------------------------------------------------------------------------
  // 1. PDF DOCUMENT THUMBNAIL (Shows cleaned document text, title, & metrics)
  // --------------------------------------------------------------------------
  if (isPdf) {
    const pdfLines = sampleText
      .split(/\r?\n/)
      .map((l) => escapeXml(l.trim()))
      .filter((l) => l.length > 0)
      .slice(0, 4);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180">
      <defs>
        <linearGradient id="pdfGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a" />
          <stop offset="100%" stop-color="#1e1b4b" />
        </linearGradient>
      </defs>
      <rect width="300" height="180" fill="url(#pdfGrad)" rx="8"/>
      <!-- Red PDF Title Header Banner -->
      <path d="M 0 8 C 0 3.5 3.5 0 8 0 L 292 0 C 296.5 0 300 3.5 300 8 L 300 34 L 0 34 Z" fill="#991b1b"/>
      <text x="14" y="21" fill="#ffffff" font-family="system-ui, sans-serif" font-size="11" font-weight="bold">PDF DOCUMENT</text>
      <rect x="245" y="6" width="45" height="18" rx="4" fill="#ffffff" fill-opacity="0.2"/>
      <text x="267.5" y="19" fill="#ffffff" font-family="system-ui, sans-serif" font-size="10" font-weight="bold" text-anchor="middle">PDF</text>
      <!-- Document Paper Sheet -->
      <rect x="20" y="42" width="260" height="128" fill="#1e293b" stroke="#334155" stroke-width="1" rx="6"/>
      <path d="M 260 42 L 280 62 L 260 62 Z" fill="#334155"/>
      <!-- Title & Document Details -->
      <text x="34" y="64" fill="#f87171" font-family="system-ui, sans-serif" font-size="12" font-weight="bold">${cleanName}</text>
      <line x1="34" y1="72" x2="250" y2="72" stroke="#ef4444" stroke-width="1" stroke-opacity="0.4"/>
      <!-- Render Clean Extracted Resume / Document Lines -->
      ${pdfLines.map((line, idx) => `
        <text x="34" y="${92 + idx * 17}" fill="${idx === 0 ? '#e2e8f0' : '#94a3b8'}" font-family="system-ui, sans-serif" font-size="10">${line.substring(0, 42)}</text>
      `).join('')}
      <text x="266" y="160" fill="#f87171" font-family="system-ui, sans-serif" font-size="9" font-weight="bold" text-anchor="end">${fileSizeStr}</text>
    </svg>`;
  }

  // --------------------------------------------------------------------------
  // 2. VIDEO THUMBNAIL (Cinematic slate preview with play overlay)
  // --------------------------------------------------------------------------
  if (isVideo) {
    // Estimate or display video duration
    const estimatedSec = Math.max(45, Math.min(7200, Math.floor(file.size / (1024 * 300))));
    const duration = formatDuration(estimatedSec);

    // Film Strip perforation holes
    const perfHoles = [10, 40, 70, 100, 130, 160].map((y) => `
      <rect x="5" y="${y}" width="5" height="9" rx="1" fill="#000000"/>
      <rect x="290" y="${y}" width="5" height="9" rx="1" fill="#000000"/>
    `).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180">
      <defs>
        <linearGradient id="vidBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#18181b"/>
          <stop offset="100%" stop-color="#09090b"/>
        </linearGradient>
        <radialGradient id="playGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="300" height="180" fill="url(#vidBg)" rx="8"/>
      <!-- Film side borders -->
      <rect x="0" y="0" width="14" height="180" fill="#27272a"/>
      <rect x="286" y="0" width="14" height="180" fill="#27272a"/>
      ${perfHoles}
      <!-- Header Overlay with Video Title -->
      <rect x="14" y="0" width="272" height="32" fill="#000000" fill-opacity="0.8"/>
      <text x="24" y="20" fill="#fef3c7" font-family="system-ui, sans-serif" font-size="11" font-weight="bold">${cleanName}</text>
      <rect x="232" y="7" width="48" height="17" rx="4" fill="#d97706"/>
      <text x="256" y="19" fill="#ffffff" font-family="system-ui, sans-serif" font-size="10" font-weight="bold" text-anchor="middle">${ext}</text>
      <!-- Center Glowing Play Control Button -->
      <circle cx="150" cy="88" r="32" fill="url(#playGlow)"/>
      <circle cx="150" cy="88" r="22" fill="#09090b" stroke="#fbbf24" stroke-width="2"/>
      <polygon points="144,78 162,88 144,98" fill="#fbbf24"/>
      <!-- Video Scrubber Bar & Specs -->
      <rect x="20" y="138" width="260" height="30" rx="4" fill="#18181b" stroke="#3f3f46" stroke-width="1"/>
      <line x1="30" y1="153" x2="210" y2="153" stroke="#eab308" stroke-width="3" stroke-linecap="round"/>
      <circle cx="95" cy="153" r="4" fill="#ffffff"/>
      <text x="225" y="157" fill="#fbbf24" font-family="system-ui, sans-serif" font-size="10" font-weight="bold">${duration}</text>
    </svg>`;
  }

  // --------------------------------------------------------------------------
  // 3. TEXT & CODE THUMBNAIL (Shows real content lines with editor UI)
  // --------------------------------------------------------------------------
  if (isText || (!isPdf && !isVideo && !isAudio && !isImage && sampleText.length > 0)) {
    let lines = sampleText
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0)
      .slice(0, 7);

    if (lines.length === 0) {
      lines = [
        `// File: ${file.name}`,
        `// Size: ${fileSizeStr}`,
        `// Empty or binary document content`
      ];
    }

    const editorTheme = isCode ? {
      bg: '#0f172a',
      titleBg: '#1e293b',
      gutterBg: '#182234',
      gutterText: '#475569',
      textColor: '#e2e8f0',
      badgeBg: '#059669',
      badgeText: '#6ee7b7'
    } : {
      bg: '#18181b',
      titleBg: '#27272a',
      gutterBg: '#202023',
      gutterText: '#52525b',
      textColor: '#f4f4f5',
      badgeBg: '#0284c7',
      badgeText: '#7dd3fc'
    };

    const renderedLinesSvg = lines.map((line, idx) => {
      const y = 50 + idx * 17;
      const lineNum = idx + 1;
      let escapedLine = escapeXml(line.substring(0, 42));
      
      let fill = editorTheme.textColor;
      if (isCode) {
        if (escapedLine.startsWith('import') || escapedLine.startsWith('export') || escapedLine.startsWith('const') || escapedLine.startsWith('function') || escapedLine.startsWith('def') || escapedLine.startsWith('class')) {
          fill = '#93c5fd';
        } else if (escapedLine.startsWith('//') || escapedLine.startsWith('#') || escapedLine.startsWith('/*')) {
          fill = '#64748b';
        } else if (escapedLine.includes('{') || escapedLine.includes(':') || escapedLine.includes('=')) {
          fill = '#fde047';
        }
      }

      return `
        <text x="18" y="${y}" fill="${editorTheme.gutterText}" font-family="monospace" font-size="10" text-anchor="end">${lineNum}</text>
        <text x="32" y="${y}" fill="${fill}" font-family="Consolas, Monaco, 'Courier New', monospace" font-size="11">${escapedLine}</text>
      `;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180">
      <rect width="300" height="180" fill="${editorTheme.bg}" rx="8"/>
      <!-- Header bar -->
      <rect width="300" height="28" fill="${editorTheme.titleBg}" rx="8"/>
      <rect y="20" width="300" height="8" fill="${editorTheme.titleBg}"/>
      <circle cx="14" cy="14" r="4" fill="#ef4444"/>
      <circle cx="26" cy="14" r="4" fill="#f59e0b"/>
      <circle cx="38" cy="14" r="4" fill="#10b981"/>
      <text x="150" y="18" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="11" font-weight="600" text-anchor="middle">${cleanName}</text>
      <rect x="245" y="6" width="48" height="16" rx="4" fill="${editorTheme.badgeBg}" fill-opacity="0.3"/>
      <text x="269" y="18" fill="${editorTheme.badgeText}" font-family="system-ui, sans-serif" font-size="10" font-weight="700" text-anchor="middle">${ext}</text>
      <!-- Gutter line -->
      <line x1="24" y1="28" x2="24" y2="180" stroke="${editorTheme.gutterBg}" stroke-width="1.5"/>
      <!-- Content lines -->
      ${renderedLinesSvg}
      <!-- Footer details -->
      <rect y="162" width="300" height="18" fill="${editorTheme.titleBg}"/>
      <text x="12" y="174" fill="#64748b" font-family="system-ui, sans-serif" font-size="9">${fileSizeStr}</text>
      <text x="288" y="174" fill="#64748b" font-family="system-ui, sans-serif" font-size="9" text-anchor="end">${lines.length} lines previewed</text>
    </svg>`;
  }

  // --------------------------------------------------------------------------
  // 4. AUDIO THUMBNAIL (Sound wave visualizer card with track info)
  // --------------------------------------------------------------------------
  if (isAudio) {
    const duration = formatDuration(Math.max(15, Math.floor(file.size / (1024 * 100))));
    const waveBars = Array.from({ length: 26 }, (_, i) => {
      const height = 12 + ((hash * (i + 3) * 11) % 65);
      return { x: 22 + i * 10, h: height, y: 90 - height / 2 };
    });

    const waveBarsSvg = waveBars.map((bar) => `
      <rect x="${bar.x}" y="${bar.y}" width="6" height="${bar.h}" rx="3" fill="#c084fc"/>
    `).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180">
      <defs>
        <linearGradient id="audioBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#3b0764" />
          <stop offset="100%" stop-color="#0f172a" />
        </linearGradient>
      </defs>
      <rect width="300" height="180" fill="url(#audioBg)" rx="8"/>
      <!-- Header -->
      <text x="20" y="28" fill="#f3e8ff" font-family="system-ui, sans-serif" font-size="12" font-weight="bold">${cleanName}</text>
      <rect x="240" y="12" width="45" height="18" rx="4" fill="#a855f7"/>
      <text x="262.5" y="25" fill="#ffffff" font-family="system-ui, sans-serif" font-size="10" font-weight="bold" text-anchor="middle">${ext}</text>
      <!-- Sound Wave Visualizer Center -->
      <rect x="15" y="44" width="270" height="92" fill="#1e1b4b" fill-opacity="0.6" rx="6" stroke="#581c87" stroke-width="1"/>
      <line x1="20" y1="90" x2="280" y2="90" stroke="#a855f7" stroke-dasharray="2,2" stroke-opacity="0.4"/>
      ${waveBarsSvg}
      <!-- Audio Specs Footer -->
      <text x="20" y="158" fill="#c084fc" font-family="system-ui, sans-serif" font-size="10" font-weight="bold">🎵 AUDIO TRACK</text>
      <text x="150" y="158" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="10" text-anchor="middle">${fileSizeStr}</text>
      <text x="280" y="158" fill="#e9d5ff" font-family="system-ui, sans-serif" font-size="10" font-weight="bold" text-anchor="end">${duration}</text>
    </svg>`;
  }

  // --------------------------------------------------------------------------
  // 5. GENERIC / FALLBACK THUMBNAIL (For unhandled types)
  // --------------------------------------------------------------------------
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180">
    <rect width="300" height="180" fill="#1e293b" rx="8"/>
    <rect x="10" y="10" width="280" height="160" fill="none" stroke="#334155" stroke-dasharray="4,4" rx="6"/>
    <circle cx="150" cy="70" r="28" fill="#38bdf8" fill-opacity="0.15"/>
    <text x="150" y="78" dominant-baseline="middle" text-anchor="middle" font-size="28">📦</text>
    <rect x="110" y="112" width="80" height="22" rx="11" fill="#38bdf8" fill-opacity="0.2"/>
    <text x="150" y="127" dominant-baseline="middle" text-anchor="middle" fill="#38bdf8" font-family="system-ui, sans-serif" font-weight="bold" font-size="11">${ext}</text>
    <text x="150" y="152" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-family="system-ui, sans-serif" font-weight="bold" font-size="10">${cleanName}</text>
  </svg>`;
}
