export interface UserPermission {
  username: string;
  displayName: string;
  email: string;
  role: string;
  namespaces: string[];
  template: string;
  lastLogin?: string;
  updatedAt?: string;
}

export interface PermissionTemplate {
  name: string;
  description: string;
  role: string;
  namespaces: string[];
  isDefault: boolean;
}
