-- scripts/03_http_snapshot_cleanup.sql
-- Invocado com: psql -v ON_ERROR_STOP=1 -d "$STAGING_DB_URL" -f scripts/03_http_snapshot_cleanup.sql
BEGIN;

DO $$
DECLARE
  v_shop_id uuid := 'b1111111-1111-1111-1111-111111111111';
  v_slug text;
BEGIN
  SELECT slug INTO v_slug FROM public.barbershops WHERE id = v_shop_id;

  IF v_slug IS NULL THEN
    RAISE NOTICE '[LIMPEZA BANCO] Barbershop ID % já não existe. Nada a limpar.', v_shop_id;
    RETURN;
  END IF;

  IF v_slug <> 'barbearia-homolog' THEN
    RAISE EXCEPTION 'PROTEÇÃO ABORTADA: Barbershop ID % tem slug "%" (não é a fixture "barbearia-homolog")', 
      v_shop_id, v_slug;
  END IF;

  -- Remoção em ordem reversa de dependência referencial
  DELETE FROM public.appointment_notifications WHERE barbershop_id = v_shop_id;
  DELETE FROM public.appointments WHERE barbershop_id = v_shop_id;
  DELETE FROM public.staff_custom_breaks WHERE barbershop_id = v_shop_id;
  DELETE FROM public.staff_schedule_blocks WHERE barbershop_id = v_shop_id;
  DELETE FROM public.staff_unavailability WHERE barbershop_id = v_shop_id;
  DELETE FROM public.staff_schedules WHERE barbershop_id = v_shop_id;
  DELETE FROM public.services WHERE barbershop_id = v_shop_id;
  DELETE FROM public.staff_profiles WHERE barbershop_id = v_shop_id;
  DELETE FROM public.barbershop_members WHERE barbershop_id = v_shop_id;
  DELETE FROM public.barbershops WHERE id = v_shop_id;

  RAISE NOTICE '[LIMPEZA BANCO CONCLUÍDA] Fixture % ("barbearia-homolog") removida com sucesso.', v_shop_id;
END $$;

COMMIT;
