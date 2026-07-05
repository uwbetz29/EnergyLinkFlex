"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listProjects,
  renameProject,
  deleteProject,
  type Project,
} from "@/app/projects/actions";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Pencil, Trash2, Check, X } from "lucide-react";

interface OpenProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function OpenProjectDialog({ open, onClose }: OpenProjectDialogProps) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setEditingId(null);
    setDeletingId(null);
    listProjects()
      .then(setProjects)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load projects")
      )
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleOpen = (projectId: string) => {
    if (editingId || deletingId) return;
    onClose();
    router.push(`/editor?project=${projectId}`);
  };

  const startRename = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setEditingId(project.id);
    setEditName(project.name);
    setDeletingId(null);
  };

  const confirmRename = async () => {
    if (!editingId || !editName.trim()) return;
    try {
      await renameProject(editingId, editName.trim());
      setProjects((prev) =>
        prev.map((p) =>
          p.id === editingId ? { ...p, name: editName.trim() } : p
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    }
    setEditingId(null);
  };

  const startDelete = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setDeletingId(projectId);
    setEditingId(null);
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteProject(deletingId);
      setProjects((prev) => prev.filter((p) => p.id !== deletingId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
    setDeletingId(null);
  };

  const drawingFilename = (p: Project) =>
    p.drawing_type === "dwg" ? p.dwg_filename : p.pdf_filename;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Open Project</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="py-2 max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[#6b8ab8]">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-8 h-8 mx-auto mb-3 text-[#ccc]" />
              <div className="text-sm font-medium text-[#888]">
                No projects yet
              </div>
              <div className="text-xs text-[#aaa] mt-1">
                Create a new project to get started
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="relative group"
                >
                  {/* Delete confirmation overlay */}
                  {deletingId === p.id ? (
                    <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between">
                      <span className="text-sm text-red-700">
                        Delete <strong>{p.name}</strong>?
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={confirmDelete}
                          className="px-3 py-1 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="px-3 py-1 rounded-lg text-xs font-semibold bg-white border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => handleOpen(p.id)}
                      className="w-full text-left px-4 py-3 rounded-xl hover:bg-[rgba(0,46,129,0.06)]
                                 transition-colors cursor-pointer group"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter") handleOpen(p.id); }}
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-[#6b8ab8] shrink-0" />
                        <div className="flex-1 min-w-0">
                          {editingId === p.id ? (
                            <div
                              className="flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                ref={editInputRef}
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") confirmRename();
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                className="flex-1 text-[14px] font-semibold text-[#001a4d] bg-white border border-[#002e81]/20 rounded-md px-2 py-0.5 outline-none focus:border-[#002e81]/50"
                              />
                              <button
                                onClick={confirmRename}
                                className="p-1 rounded hover:bg-green-100 text-green-600"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingId(null);
                                }}
                                className="p-1 rounded hover:bg-gray-100 text-gray-400"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="text-[14px] font-semibold text-[#001a4d] truncate">
                              {p.name}
                            </div>
                          )}
                          <div className="text-[11px] text-[#999] mt-0.5 flex items-center gap-1.5">
                            {p.drawing_type === "dwg" && (
                              <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                                DWG
                              </span>
                            )}
                            {drawingFilename(p) || "No drawing uploaded"}
                            <span className="opacity-40">·</span>
                            {formatDate(p.updated_at)}
                          </div>
                        </div>

                        {/* Action buttons — visible on hover */}
                        {editingId !== p.id && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => startRename(e, p)}
                              className="p-1.5 rounded-lg hover:bg-[rgba(0,46,129,0.1)] text-[#6b8ab8] hover:text-[#002e81] transition-colors"
                              title="Rename"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => startDelete(e, p.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-[#6b8ab8] hover:text-red-500 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
