/**
 * Client-side utility for communicating with Cloud Run service through our API proxy
 */

export interface CloudRunRequest {
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: any;
}

export interface CloudRunResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string;
  status?: number;
}

/**
 * Make a request to the Cloud Run service through our API proxy
 */
export async function callCloudRunService<T = any>(
  request: CloudRunRequest
): Promise<CloudRunResponse<T>> {
  try {
    const { endpoint, method = 'POST', data } = request;

    if (method === 'GET') {
      // For GET requests, use query parameters
      const params = new URLSearchParams({ endpoint });
      const response = await fetch(`/api/cloud-run?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      return result;
    } else {
      // For POST/PUT/DELETE requests, send data in body
      const response = await fetch('/api/cloud-run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          endpoint,
          method,
          data,
        }),
      });

      const result = await response.json();
      return result;
    }
  } catch (error) {
    console.error('Error calling Cloud Run service:', error);
    return {
      success: false,
      error: 'Network error',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Convenience function for GET requests
 */
export async function getFromCloudRun<T = any>(endpoint: string): Promise<CloudRunResponse<T>> {
  return callCloudRunService<T>({ endpoint, method: 'GET' });
}

/**
 * Convenience function for POST requests
 */
export async function postToCloudRun<T = any>(
  endpoint: string, 
  data: any
): Promise<CloudRunResponse<T>> {
  return callCloudRunService<T>({ endpoint, method: 'POST', data });
}

/**
 * Convenience function for PUT requests
 */
export async function putToCloudRun<T = any>(
  endpoint: string, 
  data: any
): Promise<CloudRunResponse<T>> {
  return callCloudRunService<T>({ endpoint, method: 'PUT', data });
}

/**
 * Convenience function for DELETE requests
 */
export async function deleteFromCloudRun<T = any>(endpoint: string): Promise<CloudRunResponse<T>> {
  return callCloudRunService<T>({ endpoint, method: 'DELETE' });
} 