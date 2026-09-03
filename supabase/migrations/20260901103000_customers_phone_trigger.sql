-- ==============================================================================
-- Migration: 20260901103000_customers_phone_trigger.sql
-- Descrição: Função e Trigger para validação estrita e preenchimento automático
--            de customers.phone_normalized em INSERT ou UPDATE OF phone.
-- Regra: 10 dígitos (DDD + 8 dígitos) -> mantém os 10 dígitos
--        11 dígitos (DDD + 9 + 8 dígitos) -> remove o 9 após DDD (10 dígitos)
--        11 dígitos com 3º dígito diferente de 9 ou outros tamanhos -> RAISE EXCEPTION
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.set_customer_phone_normalized()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_digits TEXT;
BEGIN
  -- Extrai apenas caracteres numéricos
  v_digits := regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g');

  -- 10 dígitos: DDD + 8 dígitos (válido)
  IF length(v_digits) = 10 THEN
    NEW.phone_normalized := v_digits;
  -- 11 dígitos: somente se o terceiro dígito for '9' (DDD + 9 + 8 dígitos)
  ELSIF length(v_digits) = 11 AND substring(v_digits FROM 3 FOR 1) = '9' THEN
    NEW.phone_normalized :=
      substring(v_digits FROM 1 FOR 2)
      || substring(v_digits FROM 4);
  ELSIF length(v_digits) = 11 AND substring(v_digits FROM 3 FOR 1) <> '9' THEN
    RAISE EXCEPTION 'Telefones com 11 dígitos devem ter 9 após o DDD.';
  ELSE
    RAISE EXCEPTION 'Telefone brasileiro inválido. Informe 10 dígitos ou 11 dígitos com 9 após o DDD.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_customer_phone_normalized_before_write
ON public.customers;

CREATE TRIGGER set_customer_phone_normalized_before_write
BEFORE INSERT OR UPDATE OF phone
ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.set_customer_phone_normalized();

COMMIT;
