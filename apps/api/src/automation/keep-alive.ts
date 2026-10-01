import http from 'node:http';
import https from 'node:https';

interface KeepAliveConfig {
  enabled: boolean;
  intervalMs: number;
  targetUrl?: string;
}

let keepAliveTimer: NodeJS.Timeout | null = null;
let lastPingTime: string | null = null;
let lastPingStatus: 'SUCCESS' | 'FAILED' | 'PENDING' | 'IDLE' = 'IDLE';
let lastPingMessage = 'Keep-alive service initialized';
let pingCount = 0;

/**
 * Resolves the target external URL for self-pinging to prevent Render free-tier instances from sleeping.
 * Render automatically sets RENDER_EXTERNAL_URL (e.g. https://omnysync-erp.onrender.com).
 */
export function resolveKeepAliveUrl(): string | undefined {
  const url = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  if (!url) return undefined;
  return url.replace(/\/+$/, '');
}

/**
 * Sends an HTTP/HTTPS GET request to the target URL's /health endpoint.
 */
export async function sendPing(targetUrl: string): Promise<{ success: boolean; statusCode?: number; message: string }> {
  return new Promise((resolve) => {
    try {
      const pingEndpoint = `${targetUrl}/health`;
      const client = pingEndpoint.startsWith('https') ? https : http;
      
      const req = client.get(pingEndpoint, {
        headers: {
          'User-Agent': 'Omnysync-KeepAlive-Agent/1.0',
          'Accept': 'application/json, text/plain, */*',
        },
        timeout: 15000,
      }, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          const success = (res.statusCode ?? 500) < 400;
          resolve({
            success,
            statusCode: res.statusCode,
            message: success 
              ? `Keep-alive ping successful (Status: ${res.statusCode})` 
              : `Keep-alive received HTTP ${res.statusCode}: ${rawData.substring(0, 100)}`,
          });
        });
      });

      req.on('error', (err) => {
        resolve({
          success: false,
          message: `Keep-alive network error: ${err.message}`,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          message: 'Keep-alive request timed out after 15s',
        });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      resolve({ success: false, message: `Failed to dispatch ping: ${msg}` });
    }
  });
}

/**
 * Initializes and starts the keep-alive / anti-sleep background scheduler.
 */
export function startKeepAliveScheduler(): void {
  const isEnabled = process.env.KEEP_ALIVE_ENABLED !== 'false';
  const intervalMinutes = Number(process.env.KEEP_ALIVE_INTERVAL_MINUTES || '10');
  const intervalMs = Math.max(2, Math.min(intervalMinutes, 14)) * 60 * 1000; // default 10 mins (Render sleeps after 15 mins)

  if (!isEnabled) {
    console.log('[Keep-Alive] Service disabled via KEEP_ALIVE_ENABLED=false');
    return;
  }

  const targetUrl = resolveKeepAliveUrl();

  if (!targetUrl) {
    console.log('[Keep-Alive] Notice: No RENDER_EXTERNAL_URL or KEEP_ALIVE_URL detected. ' +
      'Keep-alive will activate automatically once deployed to Render (RENDER_EXTERNAL_URL) or when KEEP_ALIVE_URL is set.');
    return;
  }

  console.log(`[Keep-Alive] Anti-sleep engine active. Target: ${targetUrl}/health (Interval: ${intervalMinutes} min)`);

  const triggerPing = async () => {
    pingCount += 1;
    lastPingTime = new Date().toISOString();
    const result = await sendPing(targetUrl);
    if (result.success) {
      lastPingStatus = 'SUCCESS';
      lastPingMessage = `Ping #${pingCount} OK at ${lastPingTime}`;
      console.log(`[Keep-Alive] Ping #${pingCount} to ${targetUrl}/health succeeded (Instance kept awake)`);
    } else {
      lastPingStatus = 'FAILED';
      lastPingMessage = `Ping #${pingCount} failed: ${result.message}`;
      console.warn(`[Keep-Alive] Ping #${pingCount} warning: ${result.message}`);
    }
  };

  // Run initial ping after 1 minute of uptime to let boot complete cleanly
  setTimeout(() => {
    void triggerPing();
  }, 60 * 1000);

  // Set recurring interval to ping before Render's 15-minute inactivity threshold
  keepAliveTimer = setInterval(() => {
    void triggerPing();
  }, intervalMs);
}

/**
 * Stops the keep-alive scheduler.
 */
export function stopKeepAliveScheduler(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

/**
 * Returns current status of the keep-alive service.
 */
export function getKeepAliveStatus() {
  const targetUrl = resolveKeepAliveUrl();
  return {
    enabled: process.env.KEEP_ALIVE_ENABLED !== 'false',
    targetUrl: targetUrl ? `${targetUrl}/health` : null,
    intervalMinutes: Number(process.env.KEEP_ALIVE_INTERVAL_MINUTES || '10'),
    pingCount,
    lastPingTime,
    lastPingStatus,
    lastPingMessage,
    environmentDetected: process.env.RENDER === 'true' ? 'Render' : 'Custom/Local',
  };
}
