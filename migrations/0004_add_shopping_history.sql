CREATE TABLE shopping_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  item_name TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX shopping_history_list_created
  ON shopping_history(list_id, created_at DESC);
