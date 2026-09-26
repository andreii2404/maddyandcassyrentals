"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";
import {
  getOrCreateConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
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
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const keepLatestMessageVisibleRef = useRef(true);
  const refreshTimerRef = useRef<number | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [activeId, conversations],
  );

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

  function chooseConversation(conversationId: string) {
    keepLatestMessageVisibleRef.current = true;
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
    if (!activeId || !body || sending) return;
    setSending(true);
    setDraft("");
    keepLatestMessageVisibleRef.current = true;
    try {
      const sent = await sendMessage(client, activeId, body);
      setMessages((current) => current.some((message) => message.id === sent.id)
        ? current
        : [...current, sent]);
      await refreshConversations();
      setError(null);
    } catch (sendError) {
      setDraft(body);
      setError(sendError instanceof Error ? sendError.message : "Your message could not be sent.");
    } finally {
      setSending(false);
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
        <span className={styles.liveBadge}><i /> Live updates</span>
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
                        <div className={`${styles.bubble} ${own ? styles.bubbleOwn : styles.bubbleReceived}`}>{message.body}</div>
                        <time>{formatMessageTime(message.createdAt)}</time>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.composer}>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  rows={1}
                  maxLength={2000}
                  placeholder={activeConversation.status === "open" ? "Write a message…" : "This conversation is closed"}
                  disabled={sending || activeConversation.status !== "open"}
                  aria-label="Message"
                />
                <button type="button" onClick={() => void handleSend()} disabled={sending || !draft.trim() || activeConversation.status !== "open"}>
                  {sending ? "Sending…" : "Send"}
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
