-- Existing sales created before Jose's commission exemption remain sales, but no
-- longer produce commissions. Keep any payout history for audit purposes.
UPDATE sales
SET commission_exempt = 1
WHERE id IN (
  SELECT c.sale_id
  FROM commissions c JOIN users u ON u.id = c.owner_id
  WHERE replace(lower(trim(u.full_name)), 'é', 'e') IN ('jose guerrero', 'jose ignacio guerrero')
)
OR (
  NOT EXISTS (SELECT 1 FROM commissions c WHERE c.sale_id = sales.id)
  AND lead_id IN (
    SELECT l.id FROM leads l JOIN users u ON u.id = l.owner_id
    WHERE replace(lower(trim(u.full_name)), 'é', 'e') IN ('jose guerrero', 'jose ignacio guerrero')
  )
);

UPDATE commissions
SET rate = 0, generated_amount = 0, status = 'pending', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE sale_id IN (SELECT id FROM sales WHERE commission_exempt = 1)
  AND paid_amount = 0;
