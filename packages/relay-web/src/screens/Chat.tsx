import { useEffect, useMemo, useState } from "react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import {
  api,
  ApiFault,
  type Conversation,
  type ConversationDetail,
  type Project,
} from "../api.js";
import { t } from "../copy.js";

/**
 * Chat (expansion Phase 4): assistant-ui UNSTYLED primitives over the AI SDK
 * v7 runtime — no Tailwind, every visual token from Olive Folio classes,
 * every string from the copy registry. The server stream route persists both
 * sides of the conversation; reloads hydrate from stored parts verbatim.
 */

function faultCopyId(e: unknown): string {
  return e instanceof ApiFault ? e.copyId : "error.generic.internal";
}

/** Server errors arrive as ApiError JSON in the stream error text; map them
 *  back to registry copy instead of showing raw JSON. */
function chatErrorCopyId(error: Error | undefined): string | null {
  if (!error) return null;
  try {
    const parsed = JSON.parse(error.message) as { error?: { copy_id?: string } };
    if (parsed.error?.copy_id) return parsed.error.copy_id;
  } catch {
    /* not our shape — generic retriable copy below */
  }
  return "chat.error.generic";
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="chat-msg chat-msg-user">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="chat-msg chat-msg-assistant">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function ChatThread({
  conversation,
  initialMessages,
  onTitleMaybeChanged,
}: {
  conversation: ConversationDetail;
  initialMessages: UIMessage[];
  onTitleMaybeChanged: () => void;
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/conversations/${conversation.id}/stream`,
      }),
    [conversation.id],
  );
  const chat = useChat({
    id: conversation.id,
    messages: initialMessages,
    transport,
    onFinish: onTitleMaybeChanged,
  });
  const runtime = useAISDKRuntime(chat);
  const errorCopy = chatErrorCopyId(chat.error);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat-thread">
        <ThreadPrimitive.Viewport className="chat-viewport">
          <ThreadPrimitive.Empty>
            <p className="empty">{t("chat.thread.empty")}</p>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages
            components={{ UserMessage, AssistantMessage }}
          />
        </ThreadPrimitive.Viewport>
        {errorCopy && <p className="status-error">{t(errorCopy)}</p>}
        <ComposerPrimitive.Root className="chat-composer">
          <ComposerPrimitive.Input
            className="input chat-input"
            placeholder={t("chat.composer.placeholder")}
            rows={2}
          />
          <ThreadPrimitive.If running={false}>
            <ComposerPrimitive.Send className="btn-primary">
              {t("chat.composer.send")}
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel className="btn-secondary">
              {t("chat.composer.stop")}
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export default function Chat({ conversationId }: { conversationId?: string }) {
  const [threads, setThreads] = useState<Conversation[] | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [errorCopy, setErrorCopy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const refreshThreads = () => {
    api.listConversations().then(setThreads).catch(() => setThreads([]));
  };

  useEffect(() => {
    refreshThreads();
    api
      .listProjects()
      .then((list) => setProjects(list.filter((p) => p.state === "active")))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    setDetail(null);
    setErrorCopy(null);
    setRenaming(false);
    if (!conversationId) return;
    api
      .getConversation(conversationId)
      .then(setDetail)
      .catch((e: unknown) => setErrorCopy(faultCopyId(e)));
  }, [conversationId]);

  const startNew = () => {
    api
      .createConversation()
      .then((conversation) => {
        refreshThreads();
        location.hash = `#/chat/${conversation.id}`;
      })
      .catch((e: unknown) => setErrorCopy(faultCopyId(e)));
  };

  const saveRename = () => {
    if (!detail || renameValue.trim().length === 0) return;
    api
      .patchConversation(detail.id, { title: renameValue.trim() })
      .then((updated) => {
        setDetail({ ...detail, title: updated.title });
        setRenaming(false);
        refreshThreads();
      })
      .catch((e: unknown) => setErrorCopy(faultCopyId(e)));
  };

  const removeThread = () => {
    if (!detail) return;
    if (!window.confirm(t("chat.delete.confirm"))) return;
    api
      .deleteConversation(detail.id)
      .then(() => {
        refreshThreads();
        location.hash = "#/chat";
      })
      .catch((e: unknown) => setErrorCopy(faultCopyId(e)));
  };

  const setProject = (projectId: string) => {
    if (!detail) return;
    api
      .patchConversation(detail.id, { project_id: projectId || null })
      .then((updated) => setDetail({ ...detail, project_id: updated.project_id }))
      .catch((e: unknown) => setErrorCopy(faultCopyId(e)));
  };

  const initialMessages = useMemo<UIMessage[]>(
    () => (detail ? (detail.messages as unknown as UIMessage[]) : []),
    [detail],
  );

  return (
    <section className="chat-surface">
      <aside className="chat-threads">
        <p>
          <button className="btn-primary" onClick={startNew}>
            {t("chat.new")}
          </button>
        </p>
        <h2>{t("chat.list.heading")}</h2>
        {threads === null && <p className="loading">{t("chat.loading")}</p>}
        {threads !== null && threads.length === 0 && (
          <p className="empty">{t("chat.list.empty")}</p>
        )}
        {threads !== null && threads.length > 0 && (
          <ul className="chat-thread-list">
            {threads.map(
              (thread) =>
                thread.owner_id !== "seed" && (
                  <li key={thread.id}>
                    <a
                      href={`#/chat/${thread.id}`}
                      aria-current={thread.id === conversationId ? "page" : undefined}
                    >
                      {thread.title}
                    </a>
                  </li>
                ),
            )}
          </ul>
        )}
      </aside>

      <div className="chat-main">
        {errorCopy && <p className="status-error">{t(errorCopy)}</p>}
        {!conversationId && !errorCopy && (
          <p className="empty">{t("chat.thread.empty")}</p>
        )}
        {conversationId && !detail && !errorCopy && (
          <p className="loading">{t("chat.loading")}</p>
        )}
        {detail && (
          <>
            <div className="shell-context">
              {!renaming && <strong>{detail.title}</strong>}{" "}
              {renaming ? (
                <>
                  <input
                    className="input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    maxLength={120}
                  />{" "}
                  <button className="btn-primary" onClick={saveRename}>
                    {t("projects.actions.save")}
                  </button>{" "}
                  <button className="btn-secondary" onClick={() => setRenaming(false)}>
                    {t("projects.create.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setRenameValue(detail.title);
                      setRenaming(true);
                    }}
                  >
                    {t("chat.actions.rename")}
                  </button>{" "}
                  <button className="btn-secondary" onClick={removeThread}>
                    {t("chat.actions.delete")}
                  </button>{" "}
                  <label title={t("chat.project.help")}>
                    {t("chat.project.label")}{" "}
                    <select
                      className="input"
                      value={detail.project_id ?? ""}
                      onChange={(e) => setProject(e.target.value)}
                    >
                      <option value="">{t("chat.project.none")}</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {detail.project_id && (
                    <>
                      {" "}
                      <a href={`#/projects/${detail.project_id}`}>{t("nav.projects")}</a>
                    </>
                  )}
                </>
              )}
            </div>
            <ChatThread
              key={detail.id}
              conversation={detail}
              initialMessages={initialMessages}
              onTitleMaybeChanged={refreshThreads}
            />
          </>
        )}
      </div>
    </section>
  );
}
