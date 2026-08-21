-- ==============================================================================
-- Migration: 20260814000001_phase1_structural_additive.sql
-- Descrição: Fase 1 - Preparação Estrutural Aditiva para Modelo Multi-Tenant / Multi-Staff
-- Tipo: Aditiva, Idempotente e Não-Destrutiva
-- ==============================================================================

-- 1. staff_profiles
ALTER TABLE IF EXISTS public.staff_profiles
  ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE;

-- 2. services
ALTER TABLE IF EXISTS public.services
  ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE;

-- 3. customers (preservando PK e adicionando campos de suporte)
ALTER TABLE IF EXISTS public.customers
  ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS total_visits INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_spent NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_visit TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. customer_photos
ALTER TABLE IF EXISTS public.customer_photos
  ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 5. appointments
ALTER TABLE IF EXISTS public.appointments
  ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 6. transactions
ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appointment_id UUID;

-- 7. weekly_schedule
ALTER TABLE IF EXISTS public.weekly_schedule
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff_profiles(id) ON DELETE CASCADE;

-- 8. weekly_breaks
ALTER TABLE IF EXISTS public.weekly_breaks
  ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff_profiles(id) ON DELETE CASCADE;

-- 9. blocked_slots
ALTER TABLE IF EXISTS public.blocked_slots
  ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 10. unblocked_slots
ALTER TABLE IF EXISTS public.unblocked_slots
  ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 11. notifications
ALTER TABLE IF EXISTS public.notifications
  ADD COLUMN IF NOT EXISTS barbershop_id UUID REFERENCES public.barbershops(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff_profiles(id) ON DELETE CASCADE;

-- ==============================================================================
-- ÍNDICES DE PERFORMANCE (IF NOT EXISTS)
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_appointments_barbershop_date ON public.appointments (barbershop_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_staff_date ON public.appointments (staff_id, date);
CREATE INDEX IF NOT EXISTS idx_services_barbershop ON public.services (barbershop_id);
CREATE INDEX IF NOT EXISTS idx_customers_barbershop_phone ON public.customers (barbershop_id, phone);
CREATE INDEX IF NOT EXISTS idx_transactions_barbershop_date ON public.transactions (barbershop_id, date);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_barbershop ON public.staff_profiles (barbershop_id);
CREATE INDEX IF NOT EXISTS idx_weekly_schedule_barbershop_staff_day ON public.weekly_schedule (barbershop_id, staff_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_weekly_breaks_barbershop_staff ON public.weekly_breaks (barbershop_id, staff_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_blocked_slots_barbershop_date ON public.blocked_slots (barbershop_id, date);
CREATE INDEX IF NOT EXISTS idx_unblocked_slots_barbershop_date ON public.unblocked_slots (barbershop_id, date);
CREATE INDEX IF NOT EXISTS idx_notifications_barbershop ON public.notifications (barbershop_id, created_at DESC);
