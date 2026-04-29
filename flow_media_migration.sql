-- Migration: flow_media table
-- Stores uploaded images for sendMessage flow nodes
-- Images persist independently of nodes/flows (gallery approach)

CREATE TABLE IF NOT EXISTS flow_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  url TEXT NOT NULL,
  size_bytes INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE flow_media DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS flow_media_instance_idx ON flow_media (instance_name, created_at DESC);
