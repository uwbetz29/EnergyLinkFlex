"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProjectStore } from "@/lib/projects/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  FileText,
  Trash2,
  Pencil,
  Clock,
  Home,
  Ruler,
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

interface ProjectDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectDrawer({ open, onOpenChange }: ProjectDrawerProps) {
  const router = useRouter();
  const {
    projects,
    currentProjectId,
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
    if (open) loadFromStorage();
  }, [open, loadFromStorage]);

  const sortedProjects = [...projects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const handleSwitchProject = (id: string) => {
    if (id === currentProjectId) {
      onOpenChange(false);
      return;
    }
    openProject(id);
    onOpenChange(false);
    // Reload the viewer with the new project
    window.location.reload();
  };

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    const project = createProject(newProjectName.trim());
    setShowNewDialog(false);
    setNewProjectName("");
    openProject(project.id);
    onOpenChange(false);
    window.location.reload();
  };

  const handleDeleteProject = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (confirm(`Delete "${name}"? This cannot be undone.`)) {
      deleteProject(id);
      if (id === currentProjectId) {
        router.push("/");
      }
    }
  };

  const handleStartRename = (e: React.MouseEvent, id: string, currentName: string) => {
    e.stopPropagation();
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

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-80 p-0 flex flex-col">
          <SheetHeader className="p-4 pb-0">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-[#93C90F] rounded flex items-center justify-center">
                <Ruler className="w-3 h-3 text-white" />
              </div>
              <SheetTitle className="text-sm font-semibold tracking-tight">
                ENERGY<span className="text-[#00BFDD]">LINK</span>
              </SheetTitle>
            </div>
          </SheetHeader>

          <div className="px-4 pt-3 pb-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 text-[#555]"
              onClick={() => {
                onOpenChange(false);
                router.push("/");
              }}
            >
              <Home className="w-3.5 h-3.5" />
              Back to Start
            </Button>
          </div>

          <Separator />

          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[#555]">
              Projects ({projects.length})
            </span>
            <button
              className="p-1 rounded hover:bg-[#F0F0F0] text-[#93C90F]"
              onClick={() => setShowNewDialog(true)}
              title="New Project"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <ScrollArea className="flex-1">
            <div className="px-2 pb-4 space-y-0.5">
              {sortedProjects.map((project) => {
                const isActive = project.id === currentProjectId;
                return (
                  <div
                    key={project.id}
                    className={`flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer group transition-colors ${
                      isActive
                        ? "bg-[#93C90F]/10 border border-[#93C90F]/20"
                        : "hover:bg-[#F0F0F0] border border-transparent"
                    }`}
                    onClick={() => handleSwitchProject(project.id)}
                  >
                    <FileText
                      className={`w-4 h-4 flex-shrink-0 ${
                        isActive ? "text-[#93C90F]" : "text-[#999]"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
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
                          className="h-6 text-xs"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className={`text-xs font-medium truncate block ${
                            isActive ? "text-[#222]" : "text-[#333]"
                          }`}
                        >
                          {project.name}
                        </span>
                      )}
                      <span className="text-[10px] text-[#999] flex items-center gap-1 mt-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {timeAgo(project.updatedAt)}
                      </span>
                    </div>
                    {/* Hover actions */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="p-1 rounded hover:bg-white text-[#999] hover:text-[#555]"
                        onClick={(e) => handleStartRename(e, project.id, project.name)}
                        title="Rename"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        className="p-1 rounded hover:bg-white text-[#999] hover:text-red-500"
                        onClick={(e) => handleDeleteProject(e, project.id, project.name)}
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {projects.length === 0 && (
                <div className="text-center py-8 text-xs text-[#999]">
                  <p>No projects yet</p>
                  <button
                    className="text-[#93C90F] mt-1 hover:underline"
                    onClick={() => setShowNewDialog(true)}
                  >
                    Create one
                  </button>
                </div>
              )}
            </div>
          </ScrollArea>

          <Separator />
          <div className="p-3">
            <Button
              size="sm"
              className="w-full bg-[#93C90F] hover:bg-[#86BB46] text-white gap-2"
              onClick={() => setShowNewDialog(true)}
            >
              <Plus className="w-3.5 h-3.5" />
              New Project
            </Button>
          </div>
        </SheetContent>
      </Sheet>

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
    </>
  );
}
