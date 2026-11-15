INSERT INTO "role" ("id", "name")
SELECT 'agent-manager', candidate.name
FROM (
	SELECT n, CASE WHEN n = 1 THEN 'Agent Manager' ELSE 'Agent Manager ' || n::text END AS name
	FROM generate_series(1, (SELECT count(*)::integer + 1 FROM "role")) AS n
) AS candidate
WHERE NOT EXISTS (SELECT 1 FROM "role" WHERE "id" = 'agent-manager')
	AND NOT EXISTS (SELECT 1 FROM "role" WHERE lower("role"."name") = lower(candidate.name))
ORDER BY candidate.n
LIMIT 1;
--> statement-breakpoint
INSERT INTO "role_permission" ("role_id", "permission")
SELECT 'agent-manager', 'agents:create'
WHERE EXISTS (SELECT 1 FROM "role" WHERE "id" = 'agent-manager')
ON CONFLICT ("role_id", "permission") DO NOTHING;
