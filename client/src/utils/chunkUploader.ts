import { ApiClient } from '../api/client.js';

export type UploaderStatus = 'idle' | 'uploading' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface ChunkUploaderOptions {
  file: File;
  sessionId: string;
  chunkSize: number;
  totalChunks: number;
  concurrency?: number; // Default: 3 parallel worker loops
  maxRetries?: number;  // Default: 3 retries per chunk
  onProgress?: (uploadedBytes: number, totalBytes: number, percentage: number) => void;
  onStateChange?: (status: UploaderStatus) => void;
  onError?: (error: Error) => void;
  onComplete?: (fileMeta: any) => void;
}

export class BoundedChunkUploader {
  private file: File;
  private sessionId: string;
  private chunkSize: number;
  private totalChunks: number;
  private concurrency: number;
  private maxRetries: number;

  private status: UploaderStatus = 'idle';
  private queue: number[] = [];
  private activeWorkers = 0;
  private abortController: AbortController | null = null;
  private chunkProgressMap: Map<number, number> = new Map();

  private onProgress?: (uploadedBytes: number, totalBytes: number, percentage: number) => void;
  private onStateChange?: (status: UploaderStatus) => void;
  private onError?: (error: Error) => void;
  private onComplete?: (fileMeta: any) => void;

  constructor(options: ChunkUploaderOptions) {
    this.file = options.file;
    this.sessionId = options.sessionId;
    this.chunkSize = options.chunkSize;
    this.totalChunks = options.totalChunks;
    this.concurrency = options.concurrency || 3;
    this.maxRetries = options.maxRetries || 3;

    this.onProgress = options.onProgress;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;
    this.onComplete = options.onComplete;
  }

  public getStatus(): UploaderStatus {
    return this.status;
  }

  private setStatus(newStatus: UploaderStatus) {
    this.status = newStatus;
    if (this.onStateChange) {
      this.onStateChange(newStatus);
    }
  }

  private async computeSha256(buffer: ArrayBuffer): Promise<string> {
    if (window.crypto && window.crypto.subtle) {
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Simple fallback string representation if SubtleCrypto unavailable
    return 'checksum_fallback';
  }

  private emitOverallProgress() {
    let uploadedBytes = 0;
    for (const bytes of this.chunkProgressMap.values()) {
      uploadedBytes += bytes;
    }

    const percentage = this.file.size > 0
      ? Math.min(Math.round((uploadedBytes / this.file.size) * 100), 100)
      : 0;

    if (this.onProgress) {
      this.onProgress(uploadedBytes, this.file.size, percentage);
    }
  }

  public async start(initialMissingChunks?: number[]): Promise<void> {
    if (this.status === 'uploading') return;

    this.abortController = new AbortController();

    // Determine missing chunks to enqueue
    if (initialMissingChunks && initialMissingChunks.length > 0) {
      this.queue = [...initialMissingChunks];
      // Pre-fill size for already uploaded chunks
      const uploadedSet = new Set(initialMissingChunks);
      for (let i = 0; i < this.totalChunks; i++) {
        if (!uploadedSet.has(i)) {
          const isLast = i === this.totalChunks - 1;
          const sz = isLast ? (this.file.size % this.chunkSize || this.chunkSize) : this.chunkSize;
          this.chunkProgressMap.set(i, sz);
        }
      }
    } else {
      // Query server for missing chunks
      try {
        const stateRes = await ApiClient.get<{ success: boolean; missingChunks: number[] }>(
          `/api/v1/uploads/sessions/${this.sessionId}`
        );
        this.queue = stateRes.missingChunks;
      } catch {
        // Enqueue all if query fails
        this.queue = Array.from({ length: this.totalChunks }, (_, i) => i);
      }
    }

    if (this.queue.length === 0) {
      // All chunks already present! Finalize immediately.
      await this.finalizeSession();
      return;
    }

    this.setStatus('uploading');
    this.emitOverallProgress();

    // Spawn bounded concurrency worker loop pool
    const workerCount = Math.min(this.concurrency, this.queue.length);
    this.activeWorkers = workerCount;

    for (let i = 0; i < workerCount; i++) {
      this.runWorkerLoop();
    }
  }

  private async runWorkerLoop(): Promise<void> {
    while (this.queue.length > 0 && this.status === 'uploading') {
      const chunkIndex = this.queue.shift();
      if (chunkIndex === undefined) break;

      let success = false;
      let attempt = 0;

      while (attempt < this.maxRetries && !success && this.status === 'uploading') {
        attempt++;
        try {
          await this.uploadSingleChunk(chunkIndex);
          success = true;
        } catch (err: any) {
          if (this.status !== 'uploading') break; // Aborted mid-flight

          if (attempt >= this.maxRetries) {
            console.error(`Chunk ${chunkIndex} failed after ${attempt} attempts:`, err);
            this.queue.unshift(chunkIndex); // Re-queue failed chunk for resume
            this.setStatus('failed');
            if (this.onError) this.onError(err);
            return;
          }
          // Exponential backoff delay
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 200));
        }
      }
    }

    this.activeWorkers--;

    // When all worker loops finish
    if (this.activeWorkers === 0 && this.status === 'uploading') {
      if (this.queue.length === 0) {
        await this.finalizeSession();
      }
    }
  }

  private async uploadSingleChunk(chunkIndex: number): Promise<void> {
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(this.file.size, start + this.chunkSize);
    const chunkBlob = this.file.slice(start, end);
    const arrayBuffer = await chunkBlob.arrayBuffer();

    const checksum = await this.computeSha256(arrayBuffer);

    const formData = new FormData();
    formData.append('chunk', chunkBlob, `chunk_${chunkIndex}`);
    formData.append('chunkIndex', chunkIndex.toString());

    const token = localStorage.getItem('bytestore_access_token');
    const headers: Record<string, string> = {
      'x-chunk-index': chunkIndex.toString(),
      'x-checksum': checksum,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`/api/v1/uploads/chunk/${this.sessionId}`, {
      method: 'POST',
      headers,
      body: formData,
      signal: this.abortController?.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const errorMsg = data.error?.message || res.statusText || `Chunk ${chunkIndex} upload failed`;
      throw new Error(errorMsg);
    }

    // Update chunk progress tracking
    const uploadedChunkSize = end - start;
    this.chunkProgressMap.set(chunkIndex, uploadedChunkSize);
    this.emitOverallProgress();
  }

  private async finalizeSession(): Promise<void> {
    try {
      const res = await ApiClient.post<{ success: boolean; file: any }>(
        `/api/v1/uploads/chunk/${this.sessionId}/finalize`
      );
      this.setStatus('completed');
      if (this.onComplete) {
        this.onComplete(res.file);
      }
    } catch (err: any) {
      this.setStatus('failed');
      if (this.onError) {
        this.onError(err);
      }
    }
  }

  public pause(): void {
    if (this.status !== 'uploading') return;
    this.abortController?.abort();
    this.setStatus('paused');
  }

  public async resume(): Promise<void> {
    if (this.status !== 'paused' && this.status !== 'failed') return;
    await this.start();
  }

  public async cancel(): Promise<void> {
    this.abortController?.abort();
    this.setStatus('cancelled');
    try {
      await ApiClient.post(`/api/v1/uploads/sessions/${this.sessionId}/cancel`);
    } catch {
      // Ignore
    }
  }
}
