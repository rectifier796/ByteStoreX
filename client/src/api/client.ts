export class ApiClient {
  private static getHeaders(isFormData = false): HeadersInit {
    const headers: Record<string, string> = {};
    const token = localStorage.getItem('bytestore_access_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }

  private static async tryRefreshToken(): Promise<boolean> {
    const refreshToken = localStorage.getItem('bytestore_refresh_token');
    if (!refreshToken) return false;

    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.tokens) {
        localStorage.setItem('bytestore_access_token', data.tokens.accessToken);
        localStorage.setItem('bytestore_refresh_token', data.tokens.refreshToken);
        return true;
      }
    } catch {
      // Refresh failed
    }

    localStorage.removeItem('bytestore_access_token');
    localStorage.removeItem('bytestore_refresh_token');
    return false;
  }

  private static async handleResponse<T>(res: Response, retryFn?: () => Promise<T>): Promise<T> {
    if (res.status === 401 && retryFn) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        return retryFn();
      }
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const errorMsg = data.error?.message || res.statusText || 'API Request failed';
      throw new Error(errorMsg);
    }
    return data;
  }

  static async get<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    return this.handleResponse<T>(res, () => this.get<T>(url));
  }

  static async post<T>(url: string, body?: any): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(res, () => this.post<T>(url, body));
  }

  static async patch<T>(url: string, body?: any): Promise<T> {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(res, () => this.patch<T>(url, body));
  }

  static async delete<T>(url: string, body?: any): Promise<T> {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(res, () => this.delete<T>(url, body));
  }

  static async uploadFile<T>(url: string, file: File, folderId?: string | null): Promise<T> {
    const formData = new FormData();
    formData.append('file', file);
    if (folderId) {
      formData.append('folderId', folderId);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(true),
      body: formData,
    });
    return this.handleResponse<T>(res);
  }
}
