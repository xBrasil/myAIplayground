/**
 * /autoplay command — developer-mode feature for automated conversation testing.
 *
 * Continuously selects a follow-up suggestion, sends it, and narrates both the
 * previous assistant reply and the follow-up text via TTS with alternating voices.
 */

import { createUtterance, ensureVoicesLoaded, listVoices, stopSpeaking } from './speech';

// ---------------------------------------------------------------------------
// Markdown stripping (same logic as SpeakButton)
// ---------------------------------------------------------------------------
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Speak text and wait for it to finish (resolves on end/error). */
async function speakAndWait(text: string, voiceName: string): Promise<void> {
  try {
    await ensureVoicesLoaded();
    const utterance = await createUtterance(text, voiceName);
    return new Promise<void>((resolve) => {
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  } catch {
    // If voice loading or utterance creation fails, silently continue
  }
}

/** Find the next voice name in the locale-filtered list after the given name. */
function getNextVoiceName(preferredName: string, localePrefix: string): string {
  const all = listVoices();
  const filtered = all.filter((v) => v.lang.toLowerCase().startsWith(localePrefix));
  const pool = filtered.length > 0 ? filtered : all;
  const idx = pool.findIndex((v) => v.name === preferredName);
  if (idx < 0 || pool.length <= 1) return preferredName;
  return pool[(idx + 1) % pool.length].name;
}

/** Map app locale string to BCP-47 prefix used for voice filtering. */
function localeToPrefix(locale: string): string {
  if (locale.startsWith('pt')) return 'pt';
  if (locale.startsWith('es')) return 'es';
  if (locale.startsWith('fr')) return 'fr';
  return 'en';
}

// ---------------------------------------------------------------------------
// AutoplayEngine
// ---------------------------------------------------------------------------

export interface AutoplayCallbacks {
  /** Returns the current conversation state. */
  getConversation: () => { messages: { role: string; content: string }[]; follow_ups?: string[] } | null;
  /** Returns true if a generation is currently in progress. */
  isBusy: () => boolean;
  /** Send a text message (same as handleSendText). Returns when stream finishes. */
  sendText: (text: string) => Promise<void>;
  /** Show a system notification in the UI. */
  showSystemMessage: (text: string) => void;
  /** Get the current preferred voice name. */
  getPreferredVoice: () => string;
  /** Get the current locale string, e.g. "pt-BR". */
  getLocale: () => string;
}

export class AutoplayEngine {
  private running = false;
  private cancelled = false;
  private cb: AutoplayCallbacks;

  constructor(callbacks: AutoplayCallbacks) {
    this.cb = callbacks;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Start the autoplay loop. Returns immediately. */
  start(): void {
    if (this.running) {
      this.cb.showSystemMessage('[autoplay] Already running.');
      return;
    }

    // --- Pre-flight checks ---
    if (this.cb.isBusy()) {
      this.cb.showSystemMessage('[autoplay] Cannot start while a generation is in progress.');
      return;
    }

    const conv = this.cb.getConversation();
    if (!conv) {
      this.cb.showSystemMessage('[autoplay] No active conversation.');
      return;
    }

    const assistantMsgs = conv.messages.filter((m) => m.role === 'assistant');
    if (assistantMsgs.length === 0) {
      this.cb.showSystemMessage('[autoplay] The conversation must have at least one assistant response.');
      return;
    }

    const followUps = conv.follow_ups;
    if (!followUps || followUps.length === 0) {
      this.cb.showSystemMessage('[autoplay] The last response has no follow-up suggestions.');
      return;
    }

    this.running = true;
    this.cancelled = false;
    this.cb.showSystemMessage('[autoplay] Started. Press Stop to end.');
    void this.loop();
  }

  /** Stop the autoplay loop. */
  stop(): void {
    this.cancelled = true;
    this.running = false;
    stopSpeaking();
  }

  // -----------------------------------------------------------------------
  // Main loop
  // -----------------------------------------------------------------------

  private async loop(): Promise<void> {
    try {
      while (!this.cancelled) {
        // Yield to the macrotask queue so React can commit any pending state
        // updates before we read conversation data from refs.
        await new Promise<void>((r) => setTimeout(r, 0));

        // --- 1) Pick a follow-up and send it ---
        const conv = this.cb.getConversation();
        if (!conv) { this.fail('Conversation no longer available.'); return; }

        const followUps = conv.follow_ups;
        if (!followUps || followUps.length === 0) {
          this.fail('No follow-up suggestions available to continue.');
          return;
        }

        // Pick a random follow-up
        const followUpText = followUps[Math.floor(Math.random() * followUps.length)];

        // Get the last assistant message BEFORE sending (this is the one we'll read)
        const assistantMsgs = conv.messages.filter((m) => m.role === 'assistant');
        const lastAssistantContent = assistantMsgs.length > 0
          ? assistantMsgs[assistantMsgs.length - 1].content
          : '';

        // Send the follow-up (this starts generation in the background)
        // Attach a no-op catch immediately to prevent unhandled rejection
        let sendError: unknown = null;
        const sendPromise = this.cb.sendText(followUpText).catch((err) => { sendError = err; });

        // --- 2) Immediately start TTS of the PREVIOUS assistant response ---
        if (lastAssistantContent && !this.cancelled) {
          const preferredVoice = this.cb.getPreferredVoice();
          const cleanAssistant = stripMarkdown(lastAssistantContent);
          await speakAndWait(cleanAssistant, preferredVoice);
        }
        if (this.cancelled) break;

        // --- 3) Read the follow-up text with the NEXT voice ---
        {
          const preferredVoice = this.cb.getPreferredVoice();
          const prefix = localeToPrefix(this.cb.getLocale());
          const nextVoice = getNextVoiceName(preferredVoice, prefix);
          await speakAndWait(followUpText, nextVoice);
        }
        if (this.cancelled) break;

        // --- 4) Wait for generation to complete ---
        await sendPromise;
        if (sendError) {
          this.fail('Generation was interrupted or errored.');
          return;
        }
        if (this.cancelled) break;

        // Yield again so React commits the final conversation state (with
        // follow-ups) before we check for continuation.
        await new Promise<void>((r) => setTimeout(r, 0));

        // Check the NEW conversation state for follow-ups
        const updatedConv = this.cb.getConversation();
        if (!updatedConv) { this.fail('Conversation no longer available.'); return; }

        const newFollowUps = updatedConv.follow_ups;
        if (!newFollowUps || newFollowUps.length === 0) {
          this.fail('The latest response has no follow-up suggestions. Loop ended.');
          return;
        }

        // Loop continues...
      }
    } catch (err) {
      this.fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    } finally {
      this.running = false;
      stopSpeaking();
    }
  }

  private fail(reason: string): void {
    this.running = false;
    this.cancelled = true;
    stopSpeaking();
    this.cb.showSystemMessage(`[autoplay] Stopped: ${reason}`);
  }
}
