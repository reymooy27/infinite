import { Eye, FileEdit, Plus, Trash2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useRef, useState } from "react";

interface NoteSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export default function Notes() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch("/api/notes");
      const data: NoteSummary[] = await res.json();
      setNotes(data);
      return data;
    } catch (err) {
      console.error("Failed to fetch notes", err);
      return [];
    }
  }, []);

  const loadNote = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/notes/${id}`);
      if (!res.ok) return;
      const note: Note = await res.json();
      setActiveId(note.id);
      setTitle(note.title);
      setContent(note.content);
      setPreview(false);
    } catch (err) {
      console.error("Failed to load note", err);
    }
  }, []);

  useEffect(() => {
    fetchNotes().then((data) => {
      if (data.length > 0) {
        loadNote(data[0].id);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const scheduleSave = useCallback(
    (newTitle: string, newContent: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (!activeId) return;
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          await fetch(`/api/notes/${activeId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: newTitle, content: newContent }),
          });
          fetchNotes();
        } catch (err) {
          console.error("Failed to save note", err);
        } finally {
          setSaving(false);
        }
      }, 1000);
    },
    [activeId, fetchNotes]
  );

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    scheduleSave(newTitle, content);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    scheduleSave(title, newContent);
  };

  const handleNewNote = async () => {
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return;
      const note: Note = await res.json();
      const data = await fetchNotes();
      setActiveId(note.id);
      setTitle(note.title);
      setContent(note.content);
      setPreview(false);
    } catch (err) {
      console.error("Failed to create note", err);
    }
  };

  const handleDeleteNote = async () => {
    if (!activeId) return;
    try {
      const res = await fetch(`/api/notes/${activeId}`, { method: "DELETE" });
      if (!res.ok) return;
      const data = await fetchNotes();
      setActiveId(null);
      setTitle("");
      setContent("");
      setPreview(false);
      if (data.length > 0) {
        loadNote(data[0].id);
      }
    } catch (err) {
      console.error("Failed to delete note", err);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-neutral-900 text-neutral-100">
      <div className="flex items-center gap-2 p-2 border-b border-neutral-700 shrink-0">
        <select
          className="flex-1 bg-neutral-800 text-sm px-2 py-1 rounded border border-neutral-600 outline-none cursor-pointer"
          value={activeId || ""}
          onChange={(e) => loadNote(e.target.value)}
        >
          {notes.length === 0 && <option value="">No notes</option>}
          {notes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </select>
        <button
          className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-100"
          onClick={handleNewNote}
          title="New note"
        >
          <Plus size={16} />
        </button>
        <button
          className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
          onClick={handleDeleteNote}
          disabled={!activeId}
          title="Delete note"
        >
          <Trash2 size={16} />
        </button>
        <div className="w-px h-5 bg-neutral-600" />
        <button
          className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-neutral-100"
          onClick={() => setPreview((p) => !p)}
          title={preview ? "Edit" : "Preview"}
        >
          {preview ? <FileEdit size={16} /> : <Eye size={16} />}
        </button>
        {saving && (
          <span className="text-[10px] text-neutral-500 w-12 text-right">
            Saving...
          </span>
        )}
      </div>

      {activeId && (
        <input
          className="px-3 py-2 bg-transparent text-sm font-medium border-b border-neutral-700 outline-none placeholder-neutral-500 shrink-0"
          placeholder="Note title..."
          value={title}
          onChange={handleTitleChange}
        />
      )}

      <div className="flex-1 overflow-auto">
        {!activeId ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            {notes.length === 0 ? "No notes yet. Create one." : "Select a note"}
          </div>
        ) : preview ? (
          <div className="p-4 text-sm leading-relaxed space-y-3 markdown-body">
            <Markdown remarkPlugins={[remarkGfm]}>{content || "*Empty*"}</Markdown>
          </div>
        ) : (
          <textarea
            className="w-full h-full p-4 bg-transparent text-sm leading-relaxed resize-none outline-none font-mono"
            placeholder="Start writing in Markdown..."
            value={content}
            onChange={handleContentChange}
            autoFocus
          />
        )}
      </div>
    </div>
  );
}
