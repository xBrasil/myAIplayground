import type { ClipboardEvent, KeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import type { ModelKey } from '../types';

type RecordingPhase = 'idle' | 'recording' | 'paused';

interface ComposerProps {
  busy: boolean;
  modelLoading: boolean;
  enterToSend: boolean;
  activeModelKey?: ModelKey;
  onSendText: (text: string) => Promise<void>;
  onSendFile: (text: string, file: File) => Promise<void>;
  onSendFiles: (text: string, files: File[]) => Promise<void>;
  onStop: () => void;
  droppedFiles?: File[];
  onDroppedFilesConsumed?: () => void;
  restoreComposer?: { text: string; files: File[] } | null;
  onRestoreComposerConsumed?: () => void;
}

export default function Composer({ busy, modelLoading, enterToSend, activeModelKey, onSendText, onSendFile, onSendFiles, onStop, droppedFiles, onDroppedFilesConsumed, restoreComposer, onRestoreComposerConsumed }: ComposerProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Recording
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudioFile, setRecordedAudioFile] = useState<File | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingSecondsRef = useRef(0);
  const cancelledRef = useRef(false);
  const sendOnFinalizeRef = useRef(false);

  function getMaxRecordingSeconds(): number {
    if (activeModelKey === 'e2b' || activeModelKey === 'e4b') return 30;
    return 120;
  }

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [text, autoResize]);

  // Merge externally dropped files into selectedFiles
  useEffect(() => {
    if (droppedFiles && droppedFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...droppedFiles]);
      onDroppedFilesConsumed?.();
    }
  }, [droppedFiles, onDroppedFilesConsumed]);

  // Restore composer state on send error
  useEffect(() => {
    if (restoreComposer) {
      setText(restoreComposer.text);
      if (restoreComposer.files.length > 0) {
        setSelectedFiles(restoreComposer.files);
      }
      onRestoreComposerConsumed?.();
    }
  }, [restoreComposer, onRestoreComposerConsumed]);

  useEffect(() => {
    return () => {
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // Auto-submit after finalizeAndSend produces the audio file
  useEffect(() => {
    if (sendOnFinalizeRef.current && recordedAudioFile) {
      sendOnFinalizeRef.current = false;
      void handleSubmit();
    }
  }, [recordedAudioFile]);

  async function sendFiles(textToSend: string, files: File[]) {
    setSelectedFiles([]);
    setText('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (files.length === 1) {
      await onSendFile(textToSend, files[0]);
    } else {
      await onSendFiles(textToSend, files);
    }
  }

  function encodeWav(audioBuffer: AudioBuffer): Blob {
    const channelData = audioBuffer.getChannelData(0);
    const samples = new Int16Array(channelData.length);

    for (let index = 0; index < channelData.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[index] || 0));
      samples[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    const wavBuffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(wavBuffer);

    function writeString(offset: number, value: string) {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, audioBuffer.sampleRate, true);
    view.setUint32(28, audioBuffer.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (const sample of samples) {
      view.setInt16(offset, sample, true);
      offset += 2;
    }

    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  async function convertRecordingToWav(blob: Blob): Promise<File> {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new AudioContext({ sampleRate: 16000 });

    try {
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const offlineContext = new OfflineAudioContext(1, decoded.duration * 16000, 16000);
      const source = offlineContext.createBufferSource();
      const monoBuffer = offlineContext.createBuffer(1, decoded.length, decoded.sampleRate);

      if (decoded.numberOfChannels === 1) {
        monoBuffer.copyToChannel(decoded.getChannelData(0), 0);
      } else {
        const mono = monoBuffer.getChannelData(0);
        for (let index = 0; index < decoded.length; index += 1) {
          let mixedSample = 0;
          for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
            mixedSample += decoded.getChannelData(channel)[index] || 0;
          }
          mono[index] = mixedSample / decoded.numberOfChannels;
        }
      }

      source.buffer = monoBuffer;
      source.connect(offlineContext.destination);
      source.start();
      const rendered = await offlineContext.startRendering();
      const wavBlob = encodeWav(rendered);
      return new File([wavBlob], `gravacao-${Date.now()}.wav`, { type: 'audio/wav' });
    } finally {
      await audioContext.close();
    }
  }

  async function handleSubmit() {
    if (busy) return;
    if (recordedAudioFile) {
      stopPreview();
      const audioFile = recordedAudioFile;
      const msg = text;
      setRecordedAudioFile(null);
      setText('');
      await onSendFile(msg, audioFile);
      return;
    }
    if (selectedFiles.length > 0) {
      await sendFiles(text, selectedFiles);
      return;
    }
    if (!text.trim()) return;
    const msg = text;
    setText('');
    await onSendText(msg);
  }

  function clearRecordingTimers() {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }

  function startTicking() {
    tickRef.current = setInterval(() => {
      recordingSecondsRef.current += 1;
      setRecordingSeconds(recordingSecondsRef.current);
      if (recordingSecondsRef.current >= getMaxRecordingSeconds()) {
        finalizeRecording();
      }
    }, 1000);
  }

  async function startRecording() {
    // Stop any ongoing text-to-speech or audio playback
    window.speechSynthesis.cancel();
    document.querySelectorAll('audio').forEach((a) => {
      a.pause();
      a.currentTime = 0;
    });

    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    cancelledRef.current = false;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      if (cancelledRef.current) {
        cancelledRef.current = false;
        return;
      }

      try {
        const wavFile = await convertRecordingToWav(blob);
        setRecordedAudioFile(wavFile);
      } catch {
        const fallbackFile = new File([blob], `gravacao-${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
        setRecordedAudioFile(fallbackFile);
      }
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    recordingSecondsRef.current = 0;
    setRecordingSeconds(0);
    setRecordingPhase('recording');
    startTicking();
  }

  function finalizeRecording() {
    clearRecordingTimers();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecordingPhase('idle');
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
  }

  function pauseRecording() {
    clearRecordingTimers();
    mediaRecorderRef.current?.pause();
    setRecordingPhase('paused');
  }

  function resumeRecording() {
    mediaRecorderRef.current?.resume();
    setRecordingPhase('recording');
    startTicking();
  }

  function finalizeAndSend() {
    sendOnFinalizeRef.current = true;
    finalizeRecording();
  }

  function cancelRecording() {
    if (!window.confirm(t('composer.confirmCancelRecording'))) return;
    cancelledRef.current = true;
    finalizeRecording();
    setRecordedAudioFile(null);
  }

  function discardAudio() {
    if (!window.confirm(t('composer.confirmDiscardAudio'))) return;
    stopPreview();
    setRecordedAudioFile(null);
  }

  function togglePreview() {
    if (previewPlaying) {
      stopPreview();
      return;
    }
    if (!recordedAudioFile) return;
    const url = URL.createObjectURL(recordedAudioFile);
    const audio = new Audio(url);
    previewAudioRef.current = audio;
    audio.onended = () => {
      setPreviewPlaying(false);
      URL.revokeObjectURL(url);
      previewAudioRef.current = null;
    };
    audio.play().catch(() => null);
    setPreviewPlaying(true);
  }

  function stopPreview() {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = null;
    }
    setPreviewPlaying(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!enterToSend || busy) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
          const named = new File([file], `paste-${Date.now()}.${ext}`, { type: file.type });
          imageFiles.push(named);
        }
      }
    }

    if (imageFiles.length > 0) {
      event.preventDefault();
      setSelectedFiles((prev) => [...prev, ...imageFiles]);
    }
  }

  const isRecording = recordingPhase !== 'idle';
  const hasAudio = recordedAudioFile !== null;
  const generating = busy && !modelLoading;
  const canSend = !busy && (text.trim().length > 0 || selectedFiles.length > 0 || hasAudio);
  const maxSec = getMaxRecordingSeconds();
  const timerDisplay = `${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, '0')} / ${Math.floor(maxSec / 60)}:${String(maxSec % 60).padStart(2, '0')}`;

  return (
    <section className="composer">
      {/* Thinking indicator */}
      {generating && (
        <div className="composer-thinking">
          <div className="composer-thinking__dots">
            <span />
            <span />
            <span />
          </div>
          <span className="composer-thinking__label">{t('composer.thinking')}</span>
        </div>
      )}
      {/* Audio ready pill */}
      {hasAudio && !isRecording && (
        <div className="composer-audio-pill">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          <span>{recordedAudioFile.name}</span>
          <button
            type="button"
            className="composer-audio-pill__preview"
            onClick={togglePreview}
            aria-label={previewPlaying ? t('composer.stopPreview') : t('composer.playPreview')}
            title={previewPlaying ? t('composer.stopPreview') : t('composer.playPreview')}
          >
            {previewPlaying ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
                <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polygon points="6,4 20,12 6,20" fill="currentColor" stroke="none" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="composer-audio-pill__remove"
            onClick={discardAudio}
            aria-label={t('composer.discardAudio')}
            title={t('composer.discardAudio')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* File name pills (only when no audio is staged) */}
      {selectedFiles.length > 0 && !hasAudio ? (
        <div className="composer-file-pills">
          {selectedFiles.map((file, idx) => (
            <span key={`${file.name}-${idx}`} className="composer-file-name" title={file.name}>
              {file.type.startsWith('image/') && (
                <img
                  className="composer-file-name__thumb"
                  src={URL.createObjectURL(file)}
                  alt=""
                  onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                />
              )}
              <span className="composer-file-name__text">{file.name}</span>
              <button
                type="button"
                className="composer-file-name__remove"
                onClick={() => {
                  setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));
                  if (selectedFiles.length <= 1 && fileInputRef.current) fileInputRef.current.value = '';
                }}
                aria-label={`Remove ${file.name}`}
              >×</button>
            </span>
          ))}
        </div>
      ) : null}

      {isRecording ? (
        /* Recording toolbar: indicator left, buttons right */
        <div className="composer-inner recording-bar">
          {/* Recording indicator + timer (left side) */}
          <span className={`recording-indicator${recordingPhase === 'paused' ? ' recording-indicator--paused' : ''}`}>
            <span className="recording-indicator__dot" />
            <span className="recording-timer">{timerDisplay}</span>
          </span>

          {/* Action buttons (right side) */}
          <div className="composer-actions">
            {/* Cancel / trash */}
            <button
              type="button"
              className="composer-icon-btn recording-bar__cancel"
              onClick={cancelRecording}
              aria-label={t('composer.cancelRecording')}
              title={t('composer.cancelRecording')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>

            {/* Pause / Resume */}
            {recordingPhase === 'recording' ? (
              <button
                type="button"
                className="composer-icon-btn"
                onClick={pauseRecording}
                aria-label={t('composer.pauseRecording')}
                title={t('composer.pauseRecording')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
                  <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                className="composer-icon-btn"
                onClick={resumeRecording}
                aria-label={t('composer.resumeRecording')}
                title={t('composer.resumeRecording')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}

            {/* Finalize & Send */}
            <button
              type="button"
              className="composer-icon-btn composer-icon-btn--send"
              onClick={finalizeAndSend}
              aria-label={t('composer.send')}
              title={t('composer.send')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        /* Normal composer */
        <div className="composer-inner">
          <textarea
            ref={textareaRef}
            disabled={busy}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t('composer.placeholder')}
            rows={1}
          />
          <div className="composer-actions">
            {/* Attach */}
            <button
              type="button"
              className="composer-icon-btn"
              disabled={busy || hasAudio}
              aria-label={t('composer.attachFile')}
              title={t('composer.attachFile')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                disabled={busy || hasAudio}
                onChange={(e) => {
                  const newFiles = e.target.files ? Array.from(e.target.files) : [];
                  if (newFiles.length > 0) setSelectedFiles((prev) => [...prev, ...newFiles]);
                }}
                aria-label="Anexar arquivo"
              />
            </button>

            {/* Mic (hidden when audio is staged) */}
            {!hasAudio && (
              <button
                type="button"
                className="composer-icon-btn"
                disabled={busy}
                onClick={() => void startRecording()}
                aria-label={t('composer.recordAudio')}
                title={t('composer.recordAudio')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}

            {/* Send / Stop */}
            {generating ? (
              <button
                type="button"
                className="composer-icon-btn composer-icon-btn--stop"
                onClick={onStop}
                aria-label={t('composer.stopGeneration')}
                title={t('composer.stopGeneration')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                className="composer-icon-btn composer-icon-btn--send"
                disabled={!canSend}
                onClick={() => void handleSubmit()}
                aria-label={t('composer.send')}
                title={t('composer.send')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
