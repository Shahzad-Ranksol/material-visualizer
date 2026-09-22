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
  renderOverlayTone?: string | null;
  tileScale?: number | null;
  blendMode?: string | null;
}

export type NewMaterialInput = {
  name: string;
  category: string;
  description: string;
  thumbnail: string;
  finishType: string;
  colorTone: string;
};

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
        'Content-Type': 'application/json',
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

export const deleteMaterial = (token: string, id: string): Promise<void> =>
  request(`/api/materials/${id}`, { method: 'DELETE' }, token);

export interface RemoteHotspot {
  id: string;
  showcaseImageId: string;
  label: string;
  xPct: number;
  yPct: number;
  allowedCategories: string[];
}

export interface RemoteShowcaseImage {
  id: string;
  tenantId: string;
  name: string;
  imageUrl: string;
  hotspots: RemoteHotspot[];
}

export type NewShowcaseImageInput = { name: string; imageUrl: string };
export type NewHotspotInput = { label: string; xPct: number; yPct: number; allowedCategories: string[] };

export interface PublicTenant {
  id: string;
  name: string;
  slug: string;
}

// Authed showcase management (signed-in tenant only)
export const listShowcaseImages = (token: string): Promise<RemoteShowcaseImage[]> =>
  request('/api/showcase/images', {}, token);

export const createShowcaseImage = (token: string, data: NewShowcaseImageInput): Promise<RemoteShowcaseImage> =>
  request('/api/showcase/images', { method: 'POST', body: JSON.stringify(data) }, token);

export const updateShowcaseImage = (
  token: string,
  id: string,
  data: Partial<NewShowcaseImageInput>
): Promise<RemoteShowcaseImage> => request(`/api/showcase/images/${id}`, { method: 'PUT', body: JSON.stringify(data) }, token);

export const deleteShowcaseImage = (token: string, id: string): Promise<void> =>
  request(`/api/showcase/images/${id}`, { method: 'DELETE' }, token);

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
  request(`/api/public/tenants/${slug}/showcase`);

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
