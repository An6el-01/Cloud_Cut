// Access control utility for station-based permissions

export interface UserAccess {
  role: string;
  selectedStation: string | null;
}

export interface AccessPermissions {
  canAccessManufacturing: boolean;
  canAccessPacking: boolean;
  canAccessPicking: boolean;
  canAccessStock: boolean;
  canAccessTeam: boolean;
  canAccessAnalytics: boolean;
  canAccessAdmin: boolean;
  canAccessMediumSheets: boolean;
  canAccessNestingQueue: boolean;
  canAccessCompletedCuts: boolean;
  canAccessWorkInProgress: boolean;
}

/**
 * Get access permissions based on user role and selected station
 */
export function getAccessPermissions(userAccess: UserAccess): AccessPermissions {
  const { role, selectedStation } = userAccess;

  // If no station is selected or station is 'none', use role-based access
  if (!selectedStation || selectedStation === 'none') {
    return getRoleBasedAccess(role);
  }

  // Station-based access overrides role-based access
  return getStationBasedAccess(selectedStation);
}

/**
 * Get role-based access permissions (when no station is selected)
 */
function getRoleBasedAccess(role: string): AccessPermissions {
  switch (role) {
    case 'GlobalAdmin':
    case 'SiteAdmin':
      return {
        canAccessManufacturing: true,
        canAccessPacking: true,
        canAccessPicking: true,
        canAccessStock: true,
        canAccessTeam: true,
        canAccessAnalytics: true,
        canAccessAdmin: true,
        canAccessMediumSheets: true,
        canAccessNestingQueue: true,
        canAccessCompletedCuts: true,
        canAccessWorkInProgress: true,
      };
    case 'Manager':
      return {
        canAccessManufacturing: true,
        canAccessPacking: true,
        canAccessPicking: true,
        canAccessStock: true,
        canAccessTeam: true,
        canAccessAnalytics: true,
        canAccessAdmin: false,
        canAccessMediumSheets: true,
        canAccessNestingQueue: true,
        canAccessCompletedCuts: true,
        canAccessWorkInProgress: true,
      };
    case 'Operator':
      return {
        canAccessManufacturing: true,
        canAccessPacking: false,
        canAccessPicking: false,
        canAccessStock: false,
        canAccessTeam: false,
        canAccessAnalytics: false,
        canAccessAdmin: false,
        canAccessMediumSheets: false,
        canAccessNestingQueue: false,
        canAccessCompletedCuts: false,
        canAccessWorkInProgress: false,
      };
    case 'Packer':
      return {
        canAccessManufacturing: false,
        canAccessPacking: true,
        canAccessPicking: false,
        canAccessStock: false,
        canAccessTeam: false,
        canAccessAnalytics: false,
        canAccessAdmin: false,
        canAccessMediumSheets: false,
        canAccessNestingQueue: false,
        canAccessCompletedCuts: false,
        canAccessWorkInProgress: false,
      };
    default:
      return {
        canAccessManufacturing: false,
        canAccessPacking: false,
        canAccessPicking: false,
        canAccessStock: false,
        canAccessTeam: false,
        canAccessAnalytics: false,
        canAccessAdmin: false,
        canAccessMediumSheets: false,
        canAccessNestingQueue: false,
        canAccessCompletedCuts: false,
        canAccessWorkInProgress: false,
      };
  }
}

/**
 * Get station-based access permissions (overrides role-based access)
 */
function getStationBasedAccess(station: string): AccessPermissions {
  switch (station) {
    case 'CNC':
      return {
        canAccessManufacturing: true,
        canAccessPacking: false,
        canAccessPicking: false,
        canAccessStock: false,
        canAccessTeam: false,
        canAccessAnalytics: false,
        canAccessAdmin: false,
        canAccessMediumSheets: false, // CNC users cannot access medium sheets tab
        canAccessNestingQueue: true,
        canAccessCompletedCuts: true,
        canAccessWorkInProgress: true,
      };
    case 'Packing':
      return {
        canAccessManufacturing: false,
        canAccessPacking: true,
        canAccessPicking: false,
        canAccessStock: false,
        canAccessTeam: false,
        canAccessAnalytics: false,
        canAccessAdmin: false,
        canAccessMediumSheets: false,
        canAccessNestingQueue: false,
        canAccessCompletedCuts: false,
        canAccessWorkInProgress: false,
      };
    default:
      return {
        canAccessManufacturing: false,
        canAccessPacking: false,
        canAccessPicking: false,
        canAccessStock: false,
        canAccessTeam: false,
        canAccessAnalytics: false,
        canAccessAdmin: false,
        canAccessMediumSheets: false,
        canAccessNestingQueue: false,
        canAccessCompletedCuts: false,
        canAccessWorkInProgress: false,
      };
  }
}

/**
 * Check if user can access a specific page
 */
export function canAccessPage(userAccess: UserAccess, page: keyof AccessPermissions): boolean {
  const permissions = getAccessPermissions(userAccess);
  return permissions[page];
}

/**
 * Get the default redirect page based on user access
 */
export function getDefaultRedirectPage(userAccess: UserAccess): string {
  const { role, selectedStation } = userAccess;

  // If a specific station is selected, redirect based on station
  if (selectedStation === 'CNC') {
    return '/manufacturing';
  }
  
  if (selectedStation === 'Packing') {
    return '/packing';
  }

  // If no station or 'none' is selected, use role-based redirect
  if (role === 'Packer') {
    return '/packing';
  } else {
    return '/manufacturing';
  }
} 