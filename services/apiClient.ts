import type { Material, SurfaceAnalysis } from '../types';
const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:4000';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  tenantId: string;
}

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  materialCategory: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  tenant?: AuthTenant;
}

export interface PendingRegistration {
  status: 'PENDING';
  message: string;
  tenant: { id: string; name: string; slug: string; materialCategory: string; status: 'PENDING' };
}

export interface RemoteMaterial {
  id: string;
  tenantId: string | null;
  name: string;
  category: string;
  description: string;
  thumbnail: string;
  finishType: string;
  colorTone: string;
  realWidthMm: number;
  realHeightMm: number | null;
  repeatMode: string;
  orientationDeg: number;
  jointWidthMm: number | null;
  jointColor: string | null;
  roughness: number;
  metallic: number;
  normalStrength: number;
  albedoUrl?: string | null;
  normalUrl?: string | null;
  roughnessUrl?: string | null;
  heightUrl?: string | null;
}

// Physical fields a vendor can set when creating/editing a material
export type MaterialProfileInput = Partial<
  Pick<Material, 'realWidthMm' | 'realHeightMm' | 'repeatMode' | 'orientationDeg' | 'jointWidthMm' | 'jointColor' | 'roughness' | 'metallic' | 'normalStrength'>
>;

export type NewMaterialInput = {
  name: string;
  category: string;
  description: string;
  thumbnail: string;
  finishType: string;
  colorTone: string;
} & MaterialProfileInput;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        // Let the browser set the multipart boundary for file uploads
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new ApiError(0, `Could not reach the Material Visualizer API at ${API_BASE}. Is the backend running?`);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // response body wasn't JSON; keep the generic message
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

export const register = (
  tenantName: string,
  email: string,
  password: string,
  materialCategory: string
): Promise<PendingRegistration> =>
  request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ tenantName, email, password, materialCategory }),
  });

export const login = (email: string, password: string): Promise<AuthSession> =>
  request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

export const listMaterials = (token: string): Promise<RemoteMaterial[]> =>
  request('/api/materials', {}, token);

export const createMaterial = (token: string, data: NewMaterialInput): Promise<RemoteMaterial> =>
  request('/api/materials', { method: 'POST', body: JSON.stringify(data) }, token);

export const updateMaterial = (token: string, id: string, data: Partial<NewMaterialInput>): Promise<RemoteMaterial> =>
  request(`/api/materials/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token);

// Uploads an image to object storage (MinIO locally, S3 in production) and returns its public URL
export const uploadImage = (token: string, file: Blob, folder: 'materials' | 'showcase'): Promise<{ url: string }> => {
  const body = new FormData();
  body.append('folder', folder);
  body.append('file', file, 'image.jpg');
  return request('/api/uploads/image', { method: 'POST', body }, token);
};

export const deleteMaterial = (token: string, id: string): Promise<void> =>
  request(`/api/materials/${id}`, { method: 'DELETE' }, token);

export interface RemoteHotspot {
  id: string;
  showcaseImageId: string;
  label: string;
  xPct: number;
  yPct: number;
  allowedCategories: string[];
  surfaceId?: string | null;
}

export type RemoteSurface = SurfaceAnalysis;

export interface RemoteShowcaseImage {
  id: string;
  tenantId: string;
  name: string;
  imageUrl: string;
  hotspots: RemoteHotspot[];
  surfaces: RemoteSurface[];
}

export type NewShowcaseImageInput = { name: string; imageUrl: string };
export type NewHotspotInput = {
  label: string;
  xPct: number;
  yPct: number;
  allowedCategories: string[];
  surfaceId?: string | null;
};

export type NewSurfaceInput = Omit<SurfaceAnalysis, 'id' | 'imageId'>;

export interface PublicTenant {
  id: string;
  name: string;
  slug: string;
}

// Authed showcase management (signed-in tenant only)
const normalizeImage = (img: RemoteShowcaseImage): RemoteShowcaseImage => ({
  ...img,
  surfaces: (img.surfaces ?? []).map((s) => ({ ...s, imageId: img.id })),
});

export const listShowcaseImages = (token: string): Promise<RemoteShowcaseImage[]> =>
  request<RemoteShowcaseImage[]>('/api/showcase/images', {}, token).then((images) => images.map(normalizeImage));

export const createShowcaseImage = (token: string, data: NewShowcaseImageInput): Promise<RemoteShowcaseImage> =>
  request<RemoteShowcaseImage>('/api/showcase/images', { method: 'POST', body: JSON.stringify(data) }, token).then(normalizeImage);

export const updateShowcaseImage = (
  token: string,
  id: string,
  data: Partial<NewShowcaseImageInput>
): Promise<RemoteShowcaseImage> =>
  request<RemoteShowcaseImage>(`/api/showcase/images/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token).then(normalizeImage);

export const deleteShowcaseImage = (token: string, id: string): Promise<void> =>
  request(`/api/showcase/images/${id}`, { method: 'DELETE' }, token);

export const createSurface = (token: string, imageId: string, data: NewSurfaceInput): Promise<RemoteSurface> =>
  request(`/api/showcase/images/${imageId}/surfaces`, { method: 'POST', body: JSON.stringify(data) }, token).then(withImageId(imageId));

export const updateSurface = (token: string, id: string, data: Partial<NewSurfaceInput>): Promise<RemoteSurface> =>
  request<RemoteSurface & { showcaseImageId: string }>(`/api/showcase/surfaces/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token).then(
    (s) => ({ ...s, imageId: s.showcaseImageId })
  );

export const deleteSurface = (token: string, id: string): Promise<void> =>
  request(`/api/showcase/surfaces/${id}`, { method: 'DELETE' }, token);

// The API names the parent image `showcaseImageId`; the SurfaceAnalysis contract calls it `imageId`
const withImageId = (imageId: string) => (s: unknown) => ({ ...(s as RemoteSurface), imageId });

export interface RenderCapabilities {
  exactPreview: boolean;
  studioLighting: boolean;
}

export const getRenderCapabilities = (): Promise<RenderCapabilities> => request('/api/render/capabilities');

export interface HarmonizePayload {
  original: string; // base64 PNG
  exact: string;
  mask: string;
  material: string;
  strength?: number;
}

// Optional Studio Lighting via the server's private worker; `image` null = exact render kept
export const harmonizeRender = (token: string, data: HarmonizePayload): Promise<{ image: string | null; applied: boolean; reason: string }> =>
  request('/api/render/harmonize', { method: 'POST', body: JSON.stringify(data) }, token);

export const createHotspot = (token: string, imageId: string, data: NewHotspotInput): Promise<RemoteHotspot> =>
  request(`/api/showcase/images/${imageId}/hotspots`, { method: 'POST', body: JSON.stringify(data) }, token);

export const updateHotspot = (token: string, id: string, data: Partial<NewHotspotInput>): Promise<RemoteHotspot> =>
  request(`/api/showcase/hotspots/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token);

export const deleteHotspot = (token: string, id: string): Promise<void> =>
  request(`/api/showcase/hotspots/${id}`, { method: 'DELETE' }, token);

// Public, unauthenticated storefront calls
export const getPublicTenant = (slug: string): Promise<PublicTenant> =>
  request(`/api/public/tenants/${slug}`);

export const listPublicMaterials = (slug: string): Promise<RemoteMaterial[]> =>
  request(`/api/public/tenants/${slug}/materials`);

export const listPublicShowcase = (slug: string): Promise<RemoteShowcaseImage[]> =>
  request<RemoteShowcaseImage[]>(`/api/public/tenants/${slug}/showcase`).then((images) => images.map(normalizeImage));

// Platform admin domain — structurally separate session from AuthSession,
// persisted under its own localStorage key so it never cross-contaminates
// with a signed-in vendor session.
export interface AdminSession {
  token: string;
  admin: { id: string; email: string; name: string | null };
}

export interface AdminTenant {
  id: string;
  name: string;
  slug: string;
  materialCategory: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  ownerEmail: string | null;
}

export const adminLogin = (email: string, password: string): Promise<AdminSession> =>
  request('/api/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

export const listTenants = (token: string, status?: 'PENDING' | 'APPROVED' | 'REJECTED'): Promise<AdminTenant[]> =>
  request(`/api/admin/tenants${status ? `?status=${status}` : ''}`, {}, token);

export const approveTenant = (token: string, id: string): Promise<AdminTenant> =>
  request(`/api/admin/tenants/${id}/approve`, { method: 'POST' }, token);

export const rejectTenant = (token: string, id: string): Promise<AdminTenant> =>
  request(`/api/admin/tenants/${id}/reject`, { method: 'POST' }, token);
