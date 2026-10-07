--------------------------------------------------------------------------------
-- AfwaahTracker :: 00_create_user.sql
-- Creates the application schema. Run ONCE as SYSTEM (or another DBA user)
-- connected to the pluggable database, e.g.:
--     sqlplus system/<password>@localhost:1521/FREEPDB1 @00_create_user.sql
-- (Oracle XE 21c uses the service name XEPDB1 instead of FREEPDB1.)
--
-- Change the password below if you wish; keep server/.env in sync.
--------------------------------------------------------------------------------
SET DEFINE OFF
WHENEVER SQLERROR CONTINUE

PROMPT Creating user AFWAAH ...
CREATE USER afwaah IDENTIFIED BY afwaah
    DEFAULT TABLESPACE users
    QUOTA UNLIMITED ON users;

GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE,
      CREATE TRIGGER, CREATE SEQUENCE, CREATE TYPE TO afwaah;

PROMPT User AFWAAH is ready.
EXIT
