# Database workflows

Apply the project verification in `../SKILL.md` before IDE calls. Database toolsets
are optional; use the connected server's descriptions and schemas for supported
behavior. A verified IDE project does not by itself establish the intended
database environment or authorize data changes.

## Investigate data-backed application behavior

Identify the intended existing connection from the task and project context.
Discover connections when needed and resolve ambiguous environments before
querying. Do not choose the first connection merely because it is available or
create a replacement connection as part of an ordinary investigation.

Inspect relevant schemas, object kinds, and object definitions to understand the
data model. Refresh schema metadata only when stale or absent metadata obstructs
the task. Use bounded previews or suitable queries to test a concrete hypothesis,
then correlate the evidence with the application path or failing reproduction.
Request further result pages only when they contribute to that question.

Keep connection, query, session, and result handles tied to the verified server,
project, and environment that produced them. Do not reuse handles from another
project or stale session. Editor-selected schemas are a filter, not permission
to access any selected environment.

Query execution can change data or invoke effectful database code. Connection
tests, introspection, and queries contact the selected service; they are not
project-identity probes. Perform connection changes, data mutations, or query
cancellation only within the requested task and existing authorization. Do not
treat this workflow as permission to migrate schemas or alter production data.

The result should connect bounded data evidence with the investigated behavior,
identify remaining uncertainty or truncated results, and distinguish supplied
metadata from an executed query or a verified fix.

## Tool selection

| Tool                              | Purpose and selection guidance                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `list_database_connections`       | Discover available data sources in the verified context; resolve which environment the task concerns.                |
| `test_database_connection`        | Check connectivity to an identified source when connection health is the question.                                   |
| `create_database_connection`      | Add a data-source configuration for requested setup; do not create one just to bypass a failing existing connection. |
| `edit_database_connection`        | Change an existing source's settings when requested; preserve its intended environment and identity.                 |
| `list_database_schemas`           | Discover relevant schemas; use the editor-selection filter only when it matches the task.                            |
| `list_schema_object_kinds`        | Discover supported schema-object categories before choosing an object filter.                                        |
| `list_schema_objects`             | Locate relevant objects within the selected schema instead of dumping unrelated schemas.                             |
| `get_database_object_description` | Inspect an identified object's structure and resolve ambiguous object matches.                                       |
| `introspect_schema`               | Refresh the IDE's schema metadata when missing or stale; this does not implement a schema migration.                 |
| `preview_table_data`              | Obtain bounded sample rows to investigate a data hypothesis without an unrestricted table dump.                      |
| `execute_sql_query`               | Execute task-appropriate SQL on the intended source; establish its effects and retain the returned handle lineage.   |
| `fetch_query_result`              | Page an existing result with the corresponding handle; pagination is not a new query.                                |
| `list_recent_sql_queries`         | Inspect relevant query history when available; do not automatically replay historical queries.                       |
| `cancel_sql_query`                | Cancel an identified running query belonging to the task; do not cancel another user's work.                         |
