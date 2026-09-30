export const API_BASE = '/api';

/** Error carrying the server's error code / details, or `offline` for network failures. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: any,
    public readonly offline = false,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export class ApiClient {
  private static token: string | null = localStorage.getItem('omnysync_token');

  static setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('omnysync_token', token);
    } else {
      localStorage.removeItem('omnysync_token');
    }
  }

  static getToken(): string | null {
    return this.token;
  }

  static async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    } catch (e: any) {
      throw new ApiRequestError('Network unavailable', 0, 'NETWORK', undefined, true);
    }

    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // Gateway / proxy failures (API down) come back as non-JSON 5xx pages.
      if (res.status >= 500 || res.status === 0) throw new ApiRequestError(`Server unavailable (${res.status})`, res.status, 'NETWORK', undefined, true);
      throw new ApiRequestError(`HTTP Error ${res.status}`, res.status);
    }
    if (!res.ok || !json.success) {
      const offline = res.status === 502 || res.status === 503 || res.status === 504;
      throw new ApiRequestError(json?.error?.message || `HTTP Error ${res.status}`, res.status, json?.error?.code, json?.error?.details, offline);
    }

    return json.data;
  }

  static async get<T = any>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  static async post<T = any>(endpoint: string, body?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}
