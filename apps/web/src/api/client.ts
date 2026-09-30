export const API_BASE = '/api';

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

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error?.message || `HTTP Error ${res.status}`);
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
