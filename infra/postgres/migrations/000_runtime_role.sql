-- Executed by the local PostgreSQL bootstrap superuser before numbered migrations.
-- Local-only credentials. Replace with managed credentials outside development.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime
      LOGIN PASSWORD 'change-me-local-only'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT CONNECT ON DATABASE ai_seller TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
