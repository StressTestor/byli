-- Add crypto category
INSERT INTO categories (slug, label, icon, sort_order)
VALUES ('crypto', 'Crypto', '₿', 2)
ON CONFLICT (slug) DO NOTHING;

-- Shift sort_order for existing categories to make room
UPDATE categories SET sort_order = sort_order + 1
WHERE sort_order >= 2 AND slug != 'crypto';