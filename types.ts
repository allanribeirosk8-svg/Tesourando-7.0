import { Session } from '@supabase/supabase-js';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  businessPhone?: string;
  address?: string;
  instagram?: string;
  website?: string;
  createdAt?: string;
}

export interface TenantMember {
  tenantId: string;
  userId: string;
  role: 'admin_owner' | 'staff' | 'client';
  createdAt?: string;
}

export interface Staff {
  id: string;
  tenantId: string;
  userId?: string | null;
  name: string;
  phone: string;
  photo?: string;
  status: 'active' | 'inactive';
  commissionRate: number; // e.g. 50 for 50%
  createdAt?: string;
}

export interface StaffService {
  staffId: string;
  serviceId: string;
  customPrice?: number;
  customCommissionRate?: number;
}

export interface StaffAvailability {
  id: string;
  staffId: string;
  dayOfWeek: number; // 0-6
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  breaks: string[]; // HH:MM
  isOpen: boolean;
  createdAt?: string;
}

export interface Commission {
  id: string;
  tenantId: string;
  staffId: string;
  appointmentId: string;
  serviceId: string;
  commissionRate: number;
  commissionAmount: number;
  status: 'pending' | 'paid';
  paidAt?: string;
  createdAt: string;
}

export interface ServiceItem {
  id: string;
  tenantId?: string; // Multi-tenant link
  name: string;
  price: number;
  duration: number; // in minutes
}

export interface Appointment {
  id: string;
  tenantId?: string; // Multi-tenant link
  staffId?: string;   // Staff assigned
  clientName: string;
  phone: string; // Used as unique ID for customer tracking
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  service: string;
  price: number; // Snapshot of price at booking time
  duration: number; // Total duration in minutes
  observation?: string;
  status: 'pending' | 'completed' | 'no-show';
  createdAt: number;
}

export interface Customer {
  phone: string;
  name: string;
  tenantId?: string; // Multi-tenant link
  cutCount: number;
  noShowCount?: number;
  history: { date: string; time?: string; service: string; price?: number }[];
  photos: { url: string; description?: string; date: string }[];
  avatar?: string; // Base64
}

export interface DayConfig {
  start: string; // "09:00"
  end: string;   // "19:00"
  breaks: string[]; // Array of specific times that are disabled (e.g. ["12:00", "12:30"])
  isOpen: boolean;
}

export type DaySchedule = {
  enabled: boolean;
  open: string;
  close: string;
  breakStart: string | null;
  breakEnd: string | null;
};

export interface BarberProfile {
  // Personal
  name: string;
  personalPhone: string;
  photo?: string; // Base64
  
  // Business
  shopName: string;
  businessPhone: string;
  address?: string;
  logo?: string; // Base64
  description?: string;
  instagram?: string;
  website?: string;
  working_hours?: Record<string, DaySchedule>;
  onboarding_seen?: boolean;
  slug?: string;
}

export interface Transaction {
  id: string;
  tenantId?: string; // Multi-tenant link
  staffId?: string;  // Staff linked to transaction (e.g. commission or sale)
  type: 'income' | 'expense';
  amount: number;
  description?: string;
  category: 'tip' | 'product' | 'walk_in' | 'rent' | 'supply' | 'equipment' | 'fee' | 'other';
  date: string; // YYYY-MM-DD
  linkedAppointmentId?: string;
  paymentMethod?: 'cash' | 'pix' | 'credit' | 'debit';
  createdAt: number;
}

export interface AppState {
  transactions: Transaction[];
  appointments: Appointment[];
  customers: Record<string, Customer>;
  blockedSlots: Record<string, string[]>; // date -> [times] manually blocked for a specific date
  unblockedSlots: Record<string, string[]>; // date -> [times] manually unblocked for a specific date
  weeklySchedule: Record<number, DayConfig>; // 0-6 (day of week) -> Config
  services: ServiceItem[];
  barberProfile: BarberProfile;
  session: Session | null;
  isLoading: boolean;
  
  // Multi-tenant & Multi-staff state extensions
  activeTenant: Tenant | null;
  staff: Staff[];
  userRole: 'admin_owner' | 'staff' | 'client' | null;
  permissions: {
    canManageStaff: boolean;
    canManageServices: boolean;
    canManageTenantProfile: boolean;
    canViewCaixa: boolean;
    canManageCaixa: boolean;
    canManageWeeklySchedule: boolean;
    canManageAppointments: boolean;
    canManageCustomers: boolean;
  };
  selectedStaffId: string | 'all';
  setSelectedStaffId: (id: string | 'all') => void;
  addStaff: (s: Omit<Staff, 'id' | 'tenantId'>) => Promise<void>;
  updateStaff: (id: string, updates: Partial<Staff>) => Promise<void>;
  deleteStaff: (id: string) => Promise<void>;
  getStaffAvailability: (staffId: string) => Promise<StaffAvailability[]>;
  saveStaffAvailability: (availabilities: Omit<StaffAvailability, 'id'>[]) => Promise<void>;
  
  addAppointment: (apt: Appointment, isExceptional?: boolean) => Promise<void>;
  updateAppointment: (id: string, updates: Partial<Appointment>) => void;
  finishAppointment: (id: string) => void;
  revertAppointment: (id: string) => void;
  markNoShow: (id: string) => void;
  updateCustomerPhoto: (phone: string, base64Photo: string, description?: string) => void;
  updateCustomerAvatar: (phone: string, base64Photo: string) => void;
  updateCustomer: (phone: string, updates: Partial<Customer>) => void;
  deleteAppointment: (id: string) => void;
  toggleSlotAvailability: (date: string, time: string) => void;
  toggleSlotUnblock: (date: string, time: string) => void;
  updateDayConfig: (day: number, config: Partial<DayConfig>) => void;
  toggleWeeklyBreak: (day: number, time: string) => void;
  addService: (service: ServiceItem) => void;
  removeService: (id: string) => void;
  updateService: (service: ServiceItem) => void;
  updateBarberProfile: (profile: BarberProfile) => void;
  addCustomer: (customer: Customer) => void;
  reorderServices: (services: ServiceItem[]) => void;
  addTransaction: (t: Omit<Transaction, 'id' | 'createdAt'>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  resetStore: () => void;
  loadTransactions: (startDate: string, endDate: string) => Promise<void>;
  reloadData: () => Promise<void>;
  
  // Notifications extensions
  notifications: AppNotification[];
  addNotification: (notification: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => Promise<void>;
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
}

export interface AppNotification {
  id: string;
  tenantId: string; // Multi-tenant link
  staffId?: string | null; // Targeted staff or null for admin_owner/general
  title: string;
  message: string;
  type: 'appointment_created' | 'appointment_confirmed' | 'appointment_cancelled' | 'appointment_reminder' | 'no_show_alert' | 'pending_close_alert' | 'operational_action';
  read: boolean;
  createdAt: number;
  priority?: 'high' | 'medium' | 'low';
  expiresAt?: number | null;
  groupKey?: string | null;
  groupCount?: number;
  meta?: {
    appointmentId?: string;
    clientId?: string;
    clientPhone?: string;
    price?: number;
    date?: string;
    time?: string;
    actionType?: string;
    lastGroupUpdate?: number;
  };
}
