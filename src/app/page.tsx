"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProjectStore } from "@/lib/projects/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Ruler,
  Plus,
  FolderOpen,
  Trash2,
  Pencil,
  Clock,
  FileText,
} from "lucide-react";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function StartPage() {
  const router = useRouter();
  const {
    projects,
    isLoaded,
    loadFromStorage,
    createProject,
    openProject,
    deleteProject,
    renameProject,
  } = useProjectStore();

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    const project = createProject(newProjectName.trim());
    setShowNewDialog(false);
    setNewProjectName("");
    openProject(project.id);
    router.push("/viewer");
  };

  const handleOpenProject = (id: string) => {
    openProject(id);
    router.push("/viewer");
  };

  const handleDeleteProject = (id: string, name: string) => {
    if (confirm(`Delete "${name}"? This cannot be undone.`)) {
      deleteProject(id);
    }
  };

  const handleStartRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const handleFinishRename = () => {
    if (renamingId && renameValue.trim()) {
      renameProject(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const sortedProjects = [...projects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  if (!isLoaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="animate-pulse text-[#888]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F9FA]">
      {/* Header */}
      <header className="bg-white border-b border-[#E7E7E7]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#93C90F] rounded-lg flex items-center justify-center">
              <Ruler className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-[#222]">
                ENERGY<span className="text-[#00BFDD]">LINK</span>
              </h1>
              <p className="text-[10px] text-[#999] -mt-0.5 tracking-wide">DRAWING SCALER</p>
            </div>
          </div>
          <Button
            onClick={() => setShowNewDialog(true)}
            className="bg-[#93C90F] hover:bg-[#86BB46] text-white gap-2"
          >
            <Plus className="w-4 h-4" />
            New Project
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {projects.length === 0 ? (
          /* Empty state */
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-[#93C90F]/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <FolderOpen className="w-8 h-8 text-[#93C90F]" />
            </div>
            <h2 className="text-xl font-semibold text-[#222] mb-2">
              No projects yet
            </h2>
            <p className="text-[#888] mb-6 max-w-md mx-auto">
              Create your first project to start scaling power generation drawings.
              Upload DWG or DXF files and adjust component dimensions instantly.
            </p>
            <Button
              onClick={() => setShowNewDialog(true)}
              className="bg-[#93C90F] hover:bg-[#86BB46] text-white gap-2"
              size="lg"
            >
              <Plus className="w-4 h-4" />
              Create Your First Project
            </Button>
          </div>
        ) : (
          /* Project list */
          <div>
            <h2 className="text-sm font-medium text-[#555] mb-4">
              Recent Projects ({projects.length})
            </h2>
            <div className="grid gap-3">
              {sortedProjects.map((project) => (
                <div
                  key={project.id}
                  className="bg-white rounded-lg border border-[#E7E7E7] p-4 hover:border-[#93C90F]/40 hover:shadow-sm transition-all cursor-pointer group"
                  onClick={() => handleOpenProject(project.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-[#F0F0F0] rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-[#93C90F]/10">
                        <FileText className="w-5 h-5 text-[#888] group-hover:text-[#93C90F]" />
                      </div>
                      <div className="min-w-0">
                        {renamingId === project.id ? (
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={handleFinishRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleFinishRename();
                              if (e.key === "Escape") {
                                setRenamingId(null);
                                setRenameValue("");
                              }
                            }}
                            className="h-7 text-sm font-medium"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <h3 className="font-medium text-[#222] truncate">
                            {project.name}
                          </h3>
                        )}
                        <div className="flex items-center gap-3 text-xs text-[#999] mt-0.5">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {timeAgo(project.updatedAt)}
                          </span>
                          <span>
                            {project.drawings.length} drawing{project.drawings.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="p-1.5 rounded hover:bg-[#F0F0F0] text-[#888] hover:text-[#555]"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartRename(project.id, project.name);
                        }}
                        title="Rename"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="p-1.5 rounded hover:bg-red-50 text-[#888] hover:text-red-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(project.id, project.name);
                        }}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* New Project Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-[#555] mb-1 block">
                Project Name
              </label>
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g., Independence Station SCR System"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateProject();
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateProject}
              disabled={!newProjectName.trim()}
              className="bg-[#93C90F] hover:bg-[#86BB46] text-white"
            >
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
