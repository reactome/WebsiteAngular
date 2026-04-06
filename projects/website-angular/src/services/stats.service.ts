import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, of, timeout } from 'rxjs';
import { APP_CONFIG } from '../config/config'; // NEW import

export interface ReactomeStats {
  pathways: number;
  reactions: number;
  proteins: number;
  smallMolecules: number;
  drugs: number;
  references: number;
}

interface RawStatItem {
  name: string;
  value: string;
}

@Injectable({
  providedIn: 'root',
})
export class StatsService {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  /**
   * Get the current Reactome version from APP_CONFIG
   */
  async getVersion(): Promise<string> {
    return APP_CONFIG.version.releaseNumber;
  }

  /**
   * Get the download base URL from APP_CONFIG
   */
  async getDownloadBaseUrl(): Promise<string> {
    return APP_CONFIG.downloadUrl;
  }

  /**
   * Fetch stats from the S3/CloudFront download directory
   */
  async getStats(): Promise<Observable<ReactomeStats>> {
    const defaultStats: ReactomeStats = {
      pathways: 0,
      reactions: 0,
      proteins: 0,
      smallMolecules: 0,
      drugs: 0,
      references: 0,
    };

    // During SSR, return default stats to avoid blocking
    if (!this.isBrowser) {
      return of(defaultStats);
    }

    const baseUrl = await this.getDownloadBaseUrl();
    const version = await this.getVersion();

    const url = `${baseUrl}/${version}/stats/summary_stats.json`;

    return this.http.get<RawStatItem[]>(url).pipe(
      timeout(5000), // 5 second timeout
      map((data) => this.parseStats(data)),
      catchError((error) => {
        console.error('Error fetching stats:', error);
        // Return default values if fetch fails
        return of(defaultStats);
      })
    );
  }

  /**
   * Parse the raw stats array into a structured object
   */
  private parseStats(data: RawStatItem[]): ReactomeStats {
    const statsMap = new Map<string, number>();

    for (const item of data) {
      statsMap.set(item.name, parseInt(item.value, 10));
    }

    return {
      pathways: statsMap.get('pathway') || 0,
      reactions: statsMap.get('rxn') || 0,
      proteins: statsMap.get('netProt') || 0,
      smallMolecules: statsMap.get('chemicals') || 0,
      drugs: (statsMap.get('chemDrug') || 0) + (statsMap.get('protDrug') || 0),
      references: statsMap.get('litRef') || 0,
    };
  }
}
