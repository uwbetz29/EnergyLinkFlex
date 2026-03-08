export interface Project {
  id: string;
  name: string;
  description: string;
  systemType: string;
  createdAt: string;
  updatedAt: string;
  drawings: ProjectDrawing[];
}

export interface ProjectDrawing {
  id: string;
  name: string;
  fileName: string;
  dxfContent?: string;
  createdAt: string;
  updatedAt: string;
}
