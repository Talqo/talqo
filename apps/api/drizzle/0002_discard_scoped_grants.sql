-- Agent permissions are deployment-global. Discard legacy scoped grants before
-- the following migration removes agent_id, rather than broadening their scope.
DELETE FROM "permission_grant" WHERE "agent_id" IS NOT NULL;
