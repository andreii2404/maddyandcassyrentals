"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { containsProfanity } from "@/src/lib/chatProfanity";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_SIZE_ERROR,
  CHAT_ATTACHMENT_TYPE_ERROR,
  attachmentTypeLabel,
  formatFileSize,
  isImageAttachment,
  validateChatAttachment,
} from "@/src/lib/chatAttachments";
import { createClient } from "@/src/lib/supabase/client";
import {
  ATTACHMENT_NOT_UPLOADED_MESSAGE,
  ChatAttachmentUploadError,
  DEFAULT_CUSTOMER_MESSAGE_LIMIT,
  INAPPROPRIATE_LANGUAGE_MESSAGE,
  REPLY_REQUIRED_MESSAGE,
  createAttachmentUrls,
  getOrCreateConversation,
  listConversations,
  listMessages,
  markConversationRead,
  removeChatAttachment,
  sendMessage,
  uploadChatAttachment,
  type ChatAttachment,
  type ChatConversation,
  type ChatMessage,
} from "@/src/services/messagingService";
import styles from "./MessagingWorkspace.module.css";

interface MessagingWorkspaceProps {
  mode: "customer" | "admin";
  isGuest?: boolean;
}

function formatConversationTime(value: string | null): string {
  if (!value) return "New";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function formatMessageTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0]?.slice(0, 2) || "MC")
    .toUpperCase();
}

/** A file chosen in the composer but not sent yet. */
interface PendingAttachment {
  file: File;
  /** Local object URL for an image thumbnail; null for documents. */
  previewUrl: string | null;
  mimeType: string;
}

/** Signed URLs live for an hour; refresh them a little before that. */
const ATTACHMENT_URL_TTL_MS = 55 * 60 * 1000;
const ATTACHMENT_URL_REFRESH_MS = 10 * 60 * 1000;

const ATTACHMENT_ERROR_MESSAGES = new Set([
  CHAT_ATTACHMENT_SIZE_ERROR,
  CHAT_ATTACHMENT_TYPE_ERROR,
  ATTACHMENT_NOT_UPLOADED_MESSAGE,
]);

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14.5 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-4.5-4.5Z" />
      <path d="M14 2.5V7h4.5M9 13h6M9 17h4" />
    </svg>
  );
}

/** Adds the `download` query parameter Supabase signed URLs accept. */
function downloadHref(signedUrl: string, fileName: string): string {
  return `${signedUrl}${signedUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(fileName)}`;
}

function MessageAttachment({
  attachment,
  url,
  own,
}: {
  attachment: ChatAttachment;
  url: string | null;
  own: boolean;
}) {
  const typeLabel = attachmentTypeLabel(attachment.mimeType, attachment.name);
  const sizeLabel = formatFileSize(attachment.sizeBytes);
  const details = sizeLabel ? `${typeLabel} · ${sizeLabel}` : typeLabel;
  const cardClass = `${styles.attachmentCard} ${own ? styles.attachmentCardOwn : ""}`;

  if (isImageAttachment(attachment.mimeType)) {
    return (
      <div className={cardClass}>
        {url ? (
          <a
            className={styles.imagePreview}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View image ${attachment.name}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={attachment.name} loading="lazy" />
          </a>
        ) : (
          <span className={`${styles.imagePreview} ${styles.imagePreviewLoading}`} aria-label="Loading image preview">
            <span />
          </span>
        )}
        <div className={styles.attachmentFooter}>
          <span className={styles.attachmentText}>
            <strong title={attachment.name}>{attachment.name}</strong>
            <span>{details}</span>
          </span>
          {url ? (
            <a className={styles.attachmentAction} href={downloadHref(url, attachment.name)} download={attachment.name}>
              Download
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <div className={styles.fileRow}>
        <span className={styles.fileBadge} aria-hidden="true">
          <DocumentIcon />
          <em>{typeLabel}</em>
        </span>
        <span className={styles.attachmentText}>
          <strong title={attachment.name}>{attachment.name}</strong>
          <span>{details}</span>
        </span>
      </div>
      <div className={styles.attachmentActions}>
        {url ? (
          <>
            <a
              className={styles.attachmentAction}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${attachment.name}`}
            >
              View
            </a>
            <a
              className={styles.attachmentAction}
              href={downloadHref(url, attachment.name)}
              download={attachment.name}
              aria-label={`Download ${attachment.name}`}
            >
              Download
            </a>
          </>
        ) : (
          <span className={styles.attachmentPending}>Preparing file…</span>
        )}
      </div>
    </div>
  );
}

export default function MessagingWorkspace({ mode, isGuest = false }: MessagingWorkspaceProps) {
  const client = useMemo(() => createClient(), []);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Inline composer error, currently the profanity notice.
  const [composerError, setComposerError] = useState<string | null>(null);
  const composerErrorId = useId();
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  // File chosen in the composer, its upload progress, and any upload error.
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  // True when attachmentError came from a failed send of the file still in the tray.
  const [attachmentSendFailed, setAttachmentSendFailed] = useState(false);
  const attachmentErrorId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Signed URLs for attachments shown in the thread, keyed by storage path.
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, { url: string; expiresAt: number }>>({});
  const attachmentUrlsRef = useRef(attachmentUrls);
  const [attachmentUrlTick, setAttachmentUrlTick] = useState(0);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const keepLatestMessageVisibleRef = useRef(true);
  const refreshTimerRef = useRef<number | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [activeId, conversations],
  );

  // Customers may send a limited run of messages before support replies. The
  // server is the authority (see send_chat_message), but the locally loaded
  // thread is also counted so the composer locks the moment the limit is hit,
  // without waiting for the conversation list to refresh.
  const replyGate = useMemo(() => {
    const limit = activeConversation?.customerMessageLimit || DEFAULT_CUSTOMER_MESSAGE_LIMIT;
    if (mode !== "customer" || !activeConversation) {
      return { blocked: false, pending: 0, limit };
    }

    let pendingInThread = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.conversationId !== activeConversation.id) continue;
      if (message.senderRole === "admin") break;
      if (message.senderRole === "customer") pendingInThread += 1;
    }

    const pending = Math.max(activeConversation.pendingCustomerMessages, pendingInThread);
    return { blocked: pending >= limit, pending, limit };
  }, [activeConversation, messages, mode]);

  const refreshConversations = useCallback(async (ensureCustomerThread = false) => {
    try {
      if (mode === "customer" && ensureCustomerThread) {
        await getOrCreateConversation(client);
      }
      const next = await listConversations(client);
      setConversations(next);
      setActiveId((current) => {
        if (current && next.some((conversation) => conversation.id === current)) return current;
        return next[0]?.id ?? null;
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Conversations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [client, mode]);

  const refreshMessages = useCallback(async (conversationId: string) => {
    setMessagesLoading(true);
    try {
      const next = await listMessages(client, conversationId);
      setMessages(next);
      await markConversationRead(client, conversationId);
      setConversations((current) => current.map((conversation) => (
        conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
      )));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Messages could not be loaded.");
    } finally {
      setMessagesLoading(false);
    }
  }, [client]);

  useEffect(() => {
    const timerId = window.setTimeout(() => void refreshConversations(true), 0);
    return () => window.clearTimeout(timerId);
  }, [refreshConversations]);

  useEffect(() => {
    if (!activeId) return undefined;
    const timerId = window.setTimeout(() => void refreshMessages(activeId), 0);
    return () => window.clearTimeout(timerId);
  }, [activeId, refreshMessages]);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        void refreshConversations();
        if (activeId) void refreshMessages(activeId);
      }, 120);
    };

    const channel = client
      .channel(`support-inbox:${mode}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages" },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_conversations" },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      void client.removeChannel(channel);
    };
  }, [activeId, client, mode, refreshConversations, refreshMessages]);

  useEffect(() => {
    if (!keepLatestMessageVisibleRef.current) return undefined;

    const frameId = window.requestAnimationFrame(() => {
      const messageArea = messageAreaRef.current;
      if (messageArea) messageArea.scrollTop = messageArea.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeId, messages]);

  useEffect(() => {
    attachmentUrlsRef.current = attachmentUrls;
  }, [attachmentUrls]);

  // Attachments are private, so previews and links use short-lived signed URLs.
  // Storage policies only sign files for the conversation's customer and admins.
  useEffect(() => {
    const now = Date.now();
    const paths = [...new Set(messages.flatMap((message) => (
      message.attachment ? [message.attachment.path] : []
    )))].filter((path) => {
      const cached = attachmentUrlsRef.current[path];
      return !cached || cached.expiresAt - now < ATTACHMENT_URL_REFRESH_MS;
    });
    if (paths.length === 0) return undefined;

    let cancelled = false;
    void createAttachmentUrls(client, paths).then((urls) => {
      if (cancelled || urls.size === 0) return;
      const expiresAt = Date.now() + ATTACHMENT_URL_TTL_MS;
      setAttachmentUrls((current) => {
        const next = { ...current };
        urls.forEach((url, path) => {
          next[path] = { url, expiresAt };
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [attachmentUrlTick, client, messages]);

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setAttachmentUrlTick((tick) => tick + 1),
      ATTACHMENT_URL_REFRESH_MS,
    );
    return () => window.clearInterval(intervalId);
  }, []);

  // Release the local image thumbnail when the pending file changes or unmounts.
  useEffect(() => {
    const previewUrl = pendingAttachment?.previewUrl;
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [pendingAttachment]);

  function clearPendingAttachment() {
    setPendingAttachment(null);
    setAttachmentError(null);
    setAttachmentSendFailed(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChosen(file: File | undefined) {
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    setAttachmentSendFailed(false);
    const validation = validateChatAttachment(file);
    if (!validation.ok) {
      setAttachmentError(validation.error);
      return;
    }
    setAttachmentError(null);
    setPendingAttachment({
      file,
      mimeType: validation.mimeType,
      previewUrl: isImageAttachment(validation.mimeType) ? URL.createObjectURL(file) : null,
    });
    composerInputRef.current?.focus();
  }

  function chooseConversation(conversationId: string) {
    keepLatestMessageVisibleRef.current = true;
    setComposerError(null);
    setAttachmentError(null);
    setAttachmentSendFailed(false);
    setActiveId(conversationId);
    setMobileChatOpen(true);
  }

  function handleMessageAreaScroll() {
    const messageArea = messageAreaRef.current;
    if (!messageArea) return;
    const distanceFromBottom = messageArea.scrollHeight - messageArea.scrollTop - messageArea.clientHeight;
    keepLatestMessageVisibleRef.current = distanceFromBottom <= 72;
  }

  async function handleSend() {
    const body = draft.trim();
    const attachmentToSend = pendingAttachment;
    // Text, a file, or both; a file alone is a valid message.
    if (!activeId || (!body && !attachmentToSend) || sending || replyGate.blocked) return;
    // Checked here for instant feedback; send_chat_message repeats the check on
    // the server, so a blocked message is never saved.
    if (mode === "customer" && body && containsProfanity(body)) {
      setComposerError(INAPPROPRIATE_LANGUAGE_MESSAGE);
      composerInputRef.current?.focus();
      return;
    }
    setComposerError(null);
    setAttachmentError(null);
    setAttachmentSendFailed(false);
    setSending(true);
    setDraft("");
    keepLatestMessageVisibleRef.current = true;
    let uploaded: ChatAttachment | null = null;
    try {
      if (attachmentToSend) {
        setUploadProgress(0);
        uploaded = await uploadChatAttachment(client, activeId, attachmentToSend.file, {
          onProgress: setUploadProgress,
        });
      }
      const sent = await sendMessage(client, activeId, body, undefined, uploaded);
      // The file now belongs to a stored message and must never be removed.
      uploaded = null;
      if (attachmentToSend) clearPendingAttachment();
      setMessages((current) => current.some((message) => message.id === sent.id)
        ? current
        : [...current, sent]);
      await refreshConversations();
      setError(null);
    } catch (sendError) {
      // The file was stored but no message uses it; remove it so a retry starts clean.
      if (uploaded) void removeChatAttachment(client, uploaded.path);
      setDraft(body);
      const message = sendError instanceof Error ? sendError.message : "Your message could not be sent.";
      if (message === INAPPROPRIATE_LANGUAGE_MESSAGE) {
        setComposerError(message);
      } else if (
        attachmentToSend
        || sendError instanceof ChatAttachmentUploadError
        || ATTACHMENT_ERROR_MESSAGES.has(message)
      ) {
        // The chosen file stays in the tray, so the error is shown next to it
        // and the send can be retried as-is.
        setAttachmentError(message);
        setAttachmentSendFailed(Boolean(attachmentToSend));
      } else {
        setError(message);
      }
    } finally {
      setSending(false);
      setUploadProgress(null);
    }
  }

  function conversationLabel(conversation: ChatConversation): string {
    return mode === "admin" ? conversation.customerName : "Maddy & Cassy Support";
  }

  return (
    <section
      className={`${styles.page} ${mode === "admin" ? styles.pageAdmin : styles.pageCustomer}`}
      aria-label="Messages"
    >
      <div className={styles.headingRow}>
        <div>
          <span className={styles.eyebrow}>{mode === "admin" ? "Customer care" : "Rental support"}</span>
          <h1>{mode === "admin" ? "Messages" : "Chat with us"}</h1>
          <p>{mode === "admin" ? "Reply to customer and guest questions in real time." : "Questions about a rental? Our team can help here."}</p>
        </div>
        {mode === "admin" ? <span className={styles.liveBadge}><i /> Live updates</span> : null}
      </div>

      {isGuest ? (
        <div className={styles.guestNotice}>
          <div>
            <strong>Guest conversation</strong>
            <span>This chat stays on this browser. Create an account for future cross-device conversations.</span>
          </div>
          <Link href="/sign-up">Create account</Link>
        </div>
      ) : null}

      {error ? (
        <div className={styles.errorBanner} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refreshConversations()}>Try again</button>
        </div>
      ) : null}

      <div className={`${styles.workspace} ${isGuest ? styles.workspaceGuest : ""} ${mobileChatOpen ? styles.mobileChatOpen : ""}`}>
        <aside className={styles.inbox} aria-label="Conversation list">
          <div className={styles.inboxHeader}>
            <div>
              <strong>{mode === "admin" ? "Inbox" : "Conversations"}</strong>
              <span>{conversations.length} {conversations.length === 1 ? "conversation" : "conversations"}</span>
            </div>
            <button type="button" className={styles.refreshButton} onClick={() => void refreshConversations()} aria-label="Refresh conversations">↻</button>
          </div>

          <div className={styles.conversationList}>
            {loading ? <div className={styles.listState}>Loading conversations…</div> : null}
            {!loading && conversations.length === 0 ? (
              <div className={styles.listState}>{mode === "admin" ? "No customer conversations yet." : "Your support chat will appear here."}</div>
            ) : null}
            {conversations.map((conversation) => {
              const label = conversationLabel(conversation);
              return (
                <button
                  type="button"
                  key={conversation.id}
                  className={`${styles.conversationItem} ${conversation.id === activeId ? styles.conversationItemActive : ""}`}
                  onClick={() => chooseConversation(conversation.id)}
                >
                  <span className={styles.avatar}>{initials(label)}</span>
                  <span className={styles.conversationCopy}>
                    <span className={styles.conversationTopline}>
                      <strong>{label}</strong>
                      <time>{formatConversationTime(conversation.lastMessageAt)}</time>
                    </span>
                    <span className={styles.preview}>{conversation.lastMessagePreview || "Start a conversation"}</span>
                    <span className={styles.contextLine}>
                      {conversation.bookingReference ? conversation.bookingReference : conversation.isGuest ? "Guest customer" : conversation.subject}
                    </span>
                  </span>
                  {conversation.unreadCount > 0 ? <span className={styles.unread}>{Math.min(conversation.unreadCount, 99)}</span> : null}
                </button>
              );
            })}
          </div>
        </aside>

        <div className={styles.chatPanel}>
          {activeConversation ? (
            <>
              <header className={styles.chatHeader}>
                <button type="button" className={styles.backButton} onClick={() => setMobileChatOpen(false)} aria-label="Back to conversations">←</button>
                <span className={styles.avatar}>{initials(conversationLabel(activeConversation))}</span>
                <div>
                  <strong>{conversationLabel(activeConversation)}</strong>
                  <span>{activeConversation.bookingReference ? `${activeConversation.bookingReference} · ` : ""}{activeConversation.status === "open" ? "Replies here in real time" : "Conversation closed"}</span>
                </div>
              </header>

              <div
                ref={messageAreaRef}
                className={styles.messageArea}
                aria-live="polite"
                onScroll={handleMessageAreaScroll}
              >
                {messagesLoading && messages.length === 0 ? <div className={styles.messageState}>Loading messages…</div> : null}
                {messages.map((message, index) => {
                  const own = mode === "admin" ? message.senderRole === "admin" : message.senderRole === "customer";
                  const previous = messages[index - 1];
                  const showName = !own && message.senderRole !== "system" && previous?.senderRole !== message.senderRole;
                  if (message.senderRole === "system") {
                    return <div className={styles.systemMessage} key={message.id}>{message.body}</div>;
                  }
                  return (
                    <div className={`${styles.messageRow} ${own ? styles.messageRowOwn : ""}`} key={message.id}>
                      <div className={`${styles.bubbleWrap} ${own ? styles.bubbleWrapOwn : ""}`}>
                        {showName ? <span className={styles.senderName}>{message.senderName}</span> : null}
                        {message.attachment ? (
                          <MessageAttachment
                            attachment={message.attachment}
                            url={attachmentUrls[message.attachment.path]?.url ?? null}
                            own={own}
                          />
                        ) : null}
                        {message.body ? (
                          <div className={`${styles.bubble} ${own ? styles.bubbleOwn : styles.bubbleReceived}`}>{message.body}</div>
                        ) : null}
                        <time>{formatMessageTime(message.createdAt)}</time>
                      </div>
                    </div>
                  );
                })}
              </div>

              {mode === "customer" && activeConversation.status === "open" ? (
                replyGate.blocked ? (
                  <div className={`${styles.replyNotice} ${styles.replyNoticeLocked}`} role="status">
                    <strong>{REPLY_REQUIRED_MESSAGE}</strong>
                    <span>
                      You have sent {replyGate.pending} of {replyGate.limit} messages. Messaging reopens
                      automatically as soon as Maddy &amp; Cassy Support replies.
                    </span>
                  </div>
                ) : (
                  <p className={styles.replyNotice}>Please wait for our reply. Our rental team will respond here.</p>
                )
              ) : null}

              {composerError ? (
                <div id={composerErrorId} className={styles.composerError} role="alert">
                  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path d="M10 2.5 18 17H2L10 2.5Z" />
                    <path d="M10 8v3.6M10 14.2v.1" />
                  </svg>
                  <span>{composerError}</span>
                </div>
              ) : null}

              {attachmentError ? (
                <div id={attachmentErrorId} className={styles.composerError} role="alert">
                  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path d="M10 2.5 18 17H2L10 2.5Z" />
                    <path d="M10 8v3.6M10 14.2v.1" />
                  </svg>
                  <span>{attachmentError}</span>
                  {attachmentSendFailed && pendingAttachment && activeConversation.status === "open" && !replyGate.blocked ? (
                    <button
                      type="button"
                      className={styles.composerErrorRetry}
                      onClick={() => void handleSend()}
                      disabled={sending}
                    >
                      Try again
                    </button>
                  ) : null}
                </div>
              ) : null}

              {pendingAttachment ? (
                <div className={styles.attachmentTray}>
                  <div className={styles.pendingAttachment}>
                    {pendingAttachment.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={styles.pendingThumb} src={pendingAttachment.previewUrl} alt="" />
                    ) : (
                      <span className={styles.fileBadge} aria-hidden="true">
                        <DocumentIcon />
                        <em>{attachmentTypeLabel(pendingAttachment.mimeType, pendingAttachment.file.name)}</em>
                      </span>
                    )}
                    <span className={styles.attachmentText}>
                      <strong title={pendingAttachment.file.name}>{pendingAttachment.file.name}</strong>
                      <span>
                        {uploadProgress !== null
                          ? uploadProgress < 100 ? `Uploading… ${uploadProgress}%` : "Sending…"
                          : `${attachmentTypeLabel(pendingAttachment.mimeType, pendingAttachment.file.name)} · ${formatFileSize(pendingAttachment.file.size)}`}
                      </span>
                      {uploadProgress !== null ? (
                        <span
                          className={styles.uploadProgress}
                          role="progressbar"
                          aria-label={`Uploading ${pendingAttachment.file.name}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={uploadProgress}
                        >
                          <span style={{ width: `${uploadProgress}%` }} />
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className={styles.removeAttachment}
                      onClick={clearPendingAttachment}
                      disabled={sending}
                      aria-label={`Remove ${pendingAttachment.file.name}`}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ) : null}

              <div className={`${styles.composer} ${replyGate.blocked ? styles.composerLocked : ""} ${composerError ? styles.composerInvalid : ""}`}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={CHAT_ATTACHMENT_ACCEPT}
                  hidden
                  tabIndex={-1}
                  onChange={(event) => handleFileChosen(event.target.files?.[0])}
                />
                <button
                  type="button"
                  className={styles.attachButton}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || activeConversation.status !== "open" || replyGate.blocked}
                  aria-label="Attach file"
                  aria-describedby={attachmentError ? attachmentErrorId : undefined}
                  title="Attach a JPG, PNG, PDF, DOC, or DOCX file (max 10 MB)"
                >
                  <PaperclipIcon />
                </button>
                <textarea
                  ref={composerInputRef}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (composerError && !containsProfanity(event.target.value)) setComposerError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  rows={1}
                  maxLength={2000}
                  placeholder={
                    activeConversation.status !== "open"
                      ? "This conversation is closed"
                      : replyGate.blocked
                        ? REPLY_REQUIRED_MESSAGE
                        : "Write a message…"
                  }
                  disabled={sending || activeConversation.status !== "open" || replyGate.blocked}
                  aria-label="Message"
                  aria-invalid={composerError ? true : undefined}
                  aria-describedby={composerError ? composerErrorId : undefined}
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || (!draft.trim() && !pendingAttachment) || activeConversation.status !== "open" || replyGate.blocked}
                  title={replyGate.blocked ? REPLY_REQUIRED_MESSAGE : undefined}
                >
                  {sending ? (uploadProgress !== null && uploadProgress < 100 ? "Uploading…" : "Sending…") : "Send"}
                </button>
              </div>
            </>
          ) : (
            <div className={styles.emptyChat}>
              <span>✦</span>
              <strong>{mode === "admin" ? "Select a customer conversation" : "Your support conversation is ready"}</strong>
              <p>{mode === "admin" ? "Choose a conversation from the inbox to read and reply." : "Refresh the page if the conversation does not appear."}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
