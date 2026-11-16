// The call table's scan follows a URL set in the constructor (scan.spec.ts).
declare const CONTENT_SERVICE: string;
declare const http: { get<T>(url: string): T };

export class ConstructorService {
  private base: string;
  constructor() {
    this.base = `${CONTENT_SERVICE}/data`;
  }
  species() {
    return http.get<string[]>(`${this.base}/species/main`);
  }
  unrelated() {
    return http.get<string[]>('/elsewhere');
  }
}
