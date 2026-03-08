import { create } from "zustand";
import type { Project, ProjectDrawing } from "./types";

const STORAGE_KEY = "energylinkage-projects";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

interface ProjectStore {
  projects: Project[];
  currentProjectId: string | null;
  isLoaded: boolean;

  // Actions
  loadFromStorage: () => void;
  createProject: (name: string, description?: string) => Project;
  openProject: (id: string) => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  addDrawing: (projectId: string, drawing: Omit<ProjectDrawing, "id" | "createdAt" | "updatedAt">) => ProjectDrawing;
  removeDrawing: (projectId: string, drawingId: string) => void;
  getCurrentProject: () => Project | null;
  closeProject: () => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProjectId: null,
  isLoaded: false,

  loadFromStorage: () => {
    const projects = loadProjects();
    const lastProjectId = typeof window !== "undefined"
      ? localStorage.getItem("energylinkage-current-project")
      : null;
    set({ projects, isLoaded: true, currentProjectId: lastProjectId });
  },

  createProject: (name: string, description = "") => {
    const project: Project = {
      id: generateId(),
      name,
      description,
      systemType: "scr-co-catalyst",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      drawings: [],
    };
    const projects = [...get().projects, project];
    saveProjects(projects);
    set({ projects, currentProjectId: project.id });
    localStorage.setItem("energylinkage-current-project", project.id);
    return project;
  },

  openProject: (id: string) => {
    set({ currentProjectId: id });
    localStorage.setItem("energylinkage-current-project", id);
  },

  deleteProject: (id: string) => {
    const { projects, currentProjectId } = get();
    const updated = projects.filter((p) => p.id !== id);
    saveProjects(updated);
    set({
      projects: updated,
      currentProjectId: currentProjectId === id ? null : currentProjectId,
    });
    if (currentProjectId === id) {
      localStorage.removeItem("energylinkage-current-project");
    }
  },

  renameProject: (id: string, name: string) => {
    const projects = get().projects.map((p) =>
      p.id === id ? { ...p, name, updatedAt: new Date().toISOString() } : p
    );
    saveProjects(projects);
    set({ projects });
  },

  updateProject: (id: string, updates: Partial<Project>) => {
    const projects = get().projects.map((p) =>
      p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
    );
    saveProjects(projects);
    set({ projects });
  },

  addDrawing: (projectId: string, drawingData) => {
    const drawing: ProjectDrawing = {
      ...drawingData,
      id: generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const projects = get().projects.map((p) =>
      p.id === projectId
        ? { ...p, drawings: [...p.drawings, drawing], updatedAt: new Date().toISOString() }
        : p
    );
    saveProjects(projects);
    set({ projects });
    return drawing;
  },

  removeDrawing: (projectId: string, drawingId: string) => {
    const projects = get().projects.map((p) =>
      p.id === projectId
        ? { ...p, drawings: p.drawings.filter((d) => d.id !== drawingId), updatedAt: new Date().toISOString() }
        : p
    );
    saveProjects(projects);
    set({ projects });
  },

  getCurrentProject: () => {
    const { projects, currentProjectId } = get();
    return projects.find((p) => p.id === currentProjectId) || null;
  },

  closeProject: () => {
    set({ currentProjectId: null });
    localStorage.removeItem("energylinkage-current-project");
  },
}));
