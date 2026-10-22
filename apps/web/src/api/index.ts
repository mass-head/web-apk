import { IApiClient } from './client';
import { HttpBuildAdapter } from './httpAdapter';

// Connect the frontend directly to the real API backend pipeline
const apiUrl = import.meta.env.VITE_API_URL || '/api';

export const apiClient: IApiClient = new HttpBuildAdapter(apiUrl);

export * from './types';
export * from './client';
