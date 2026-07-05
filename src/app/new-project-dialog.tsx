"use client";

import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createProject, uploadProjectPdf } from "@/app/projects/actions";
import { Upload, X, FileText } from "lucide-react";

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}

function isDwgFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".dwg");
}

function fileLabel(file: File): string {
  return isDwgFile(file) ? "DWG" : "PDF";
}

export function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim() && files.length === 0) {
      setError("Project name and drawing file are required");
      return;
    }
    if (files.length === 0) {
      setError("Please select at least one drawing file (PDF or DWG)");
      return;
    }

    const oversized = files.find((f) => f.size > 50 * 1024 * 1024);
    if (oversized) {
      setError(`${oversized.name} exceeds 50 MB limit`);
      return;
    }

    try {
      setLoading(true);

      // Detect multi-sheet DWG: multiple DWG files = sheets of the same system
      const dwgFiles = files.filter(isDwgFile);
      const pdfFiles = files.filter((f) => !isDwgFile(f));
      const isMultiSheet = dwgFiles.length > 1;

      if (isMultiSheet) {
        // ─── Multi-sheet DWG upload ───
        const projectName =
          name.trim() ||
          dwgFiles[0].name.replace(/\.[^.]+$/, "").replace(/_Sheet_?\d+/i, "");

        setProgress("Creating project...");
        const { id: projectId } = await createProject(projectName);

        setProgress(`Parsing ${dwgFiles.length} DWG sheets...`);
        const formData = new FormData();
        formData.append("projectId", projectId);
        for (const file of dwgFiles) {
          formData.append("files", file);
        }

        const res = await fetch("/api/dwg/parse-multi", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body.error || `Multi-sheet DWG parse failed (${res.status})`
          );
        }

        const result = await res.json();
        setProgress(
          `Parsed ${result.sheetCount} sheets — Opening editor...`
        );
        onCreated(projectId);
        return;
      }

      // ─── Single-file uploads (one project per file) ───
      let lastProjectId = "";

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const projectName =
          files.length === 1
            ? name.trim() || file.name.replace(/\.[^.]+$/, "")
            : `${name.trim() || "Import"} — ${file.name.replace(/\.[^.]+$/, "")}`;

        setProgress(
          files.length > 1
            ? `Creating project ${i + 1}/${files.length}...`
            : "Creating project..."
        );
        const { id: projectId } = await createProject(projectName);
        lastProjectId = projectId;

        if (isDwgFile(file)) {
          setProgress(
            files.length > 1
              ? `Parsing DWG ${i + 1}/${files.length}...`
              : "Uploading & parsing DWG..."
          );
          const formData = new FormData();
          formData.append("file", file);
          formData.append("projectId", projectId);

          const res = await fetch("/api/dwg/parse", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(
              body.error || `DWG parse failed for ${file.name} (${res.status})`
            );
          }
        } else {
          setProgress(
            files.length > 1
              ? `Uploading PDF ${i + 1}/${files.length}...`
              : "Uploading drawing..."
          );
          const formData = new FormData();
          formData.append("file", file);
          await uploadProjectPdf(projectId, formData);
        }
      }

      setProgress("Opening editor...");
      onCreated(lastProjectId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  const handleClose = () => {
    if (loading) return;
    setName("");
    setFiles([]);
    setError("");
    setProgress("");
    if (fileRef.current) fileRef.current.value = "";
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) {
      setFiles((prev) => [...prev, ...selected]);
      // Auto-fill name from first file if empty
      if (!name && files.length === 0 && selected.length === 1) {
        setName(selected[0].name.replace(/\.[^.]+$/, ""));
      }
    }
    // Reset input so same file can be re-selected
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium text-[#555] mb-1 block">
              Project Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Carter Machinery — Independence #1"
              autoFocus
              disabled={loading}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[#555] mb-1 block">
              Drawing Files
            </label>

            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {files.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f5f7fa] border border-[#e8ecf0]"
                  >
                    <FileText className="w-4 h-4 text-[#6b8ab8] flex-shrink-0" />
                    <span className="text-[13px] font-medium text-[#001a4d] flex-1 truncate">
                      {file.name}
                    </span>
                    <span className="text-[10px] text-[#999]">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isDwgFile(file)
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {fileLabel(file)}
                    </span>
                    {!loading && (
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="p-0.5 rounded hover:bg-red-50 text-[#ccc] hover:text-red-400 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Drop zone */}
            <div
              className={`relative border-2 border-dashed rounded-xl p-4 text-center transition-colors cursor-pointer
                ${files.length > 0 ? "border-[#ddd] hover:border-[#002e81]/30" : "border-[#ddd] hover:border-[#002e81]/30 hover:bg-[#002e81]/3 p-6"}`}
              onClick={() => !loading && fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.dwg"
                multiple
                className="hidden"
                onChange={handleFileChange}
                disabled={loading}
              />
              <Upload className={`mx-auto mb-1.5 text-[#6b8ab8] ${files.length > 0 ? "w-4 h-4" : "w-6 h-6 mb-2"}`} />
              <div className={`font-medium text-[#666] ${files.length > 0 ? "text-xs" : "text-sm"}`}>
                {files.length > 0 ? "Add more files" : "Click to select drawings"}
              </div>
              {files.length === 0 && (
                <div className="text-xs text-[#999] mt-0.5">
                  PDF or DWG — Multiple files OK — Max 50 MB each
                </div>
              )}
            </div>

            {files.some(isDwgFile) && (
              <div className="text-[10px] text-emerald-600 mt-1.5">
                Component data will be extracted automatically from DWG files
              </div>
            )}
            {files.filter(isDwgFile).length > 1 && (
              <div className="text-[10px] text-emerald-600 mt-1 font-medium">
                ⚡ Multi-sheet mode — {files.filter(isDwgFile).length} DWG files will be parsed as views of the same system
              </div>
            )}
            {files.length > 1 && files.filter(isDwgFile).length <= 1 && (
              <div className="text-[10px] text-[#6b8ab8] mt-1">
                Each file will create a separate project
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || files.length === 0}
              className="bg-[#002e81] hover:bg-[#0a3d99] text-white"
            >
              {loading
                ? progress || "Creating..."
                : files.filter(isDwgFile).length > 1
                  ? `Create Multi-Sheet Project`
                  : files.length > 1
                    ? `Create ${files.length} Projects`
                    : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
