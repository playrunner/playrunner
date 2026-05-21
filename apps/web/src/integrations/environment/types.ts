export interface EnvVar {
  id: string;
  key: string;
  type: 'default' | 'secret';
  initialValue: string;
  currentValue: string;
  enabled: boolean;
}

export interface SavedEnvironment {
  id: string;
  userId: string;
  name: string;
  description?: string;
  variables: EnvVar[];
  createdAt: string;
  updatedAt: string;
}
