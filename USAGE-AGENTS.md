## Executor Tools

When using the executor to call external APIs:

### Quick Reference

| Operation | Code Pattern | Notes |
|-----------|--------------|-------|
| List sources | `tools.executor.sources.list()` | Returns all configured sources with tool counts |
| Discover tools | `tools.search({ query, namespace?, limit? })` | Pass an **object** with query string |
| Get tool details | `tools.describe.tool({ path })` | Returns TypeScript input/output shapes |
| Call a tool | `tools.<namespace>.<tool>(args)` | Must use namespace prefix |

### Workflow

1. **List available sources** (especially for new integrations):
   ```ts
   const sources = await tools.executor.sources.list();
   // Returns: [{ id: "home_assistant_rest_api", toolCount: 17, ... }]
   ```

2. **Discover tools by intent**:
   ```ts
   const matches = await tools.search({ query: "garage door state", limit: 5 });
   ```
   - If no results, try broader terms like "state", "entity", "switch"
   - To narrow to a specific source: `{ namespace: "home_assistant_rest_api", query: "state" }`

3. **Inspect the tool schema** before calling:
   ```ts
   const details = await tools.describe.tool({ path: matches[0]?.path });
   // Returns: { inputTypeScript, outputTypeScript, typeScriptDefinitions }
   ```

4. **Call the tool using the full path** (namespace + tool name):
   ```ts
   // ✅ Works - use full path with namespace prefix
   const result = await tools.home_assistant_rest_api.states.getState({ entity_id: "cover.garage_door" });

   // ❌ Fails - ToolNotFoundError (missing namespace prefix)
   const result = await tools.states.getState({ entity_id: "cover.garage_door" });
   ```

5. **For getStates / getAll** - filter the results in code:
   ```ts
   const all = await tools.home_assistant_rest_api.states.getStates();
   const doors = all.filter(e => e.entity_id.includes('garage'));
   ```
   (Warning: returns all entities - can be 500KB+ of data)

### Common Gotchas

- **`tools.search()` requires an object** — `tools.search("query")` fails. Use `tools.search({ query: "query" })`.
- **Always use namespace prefix** — `tools.states.getState()` fails; use `tools.<sourceId>.states.getState()`.
- **`tools` is a lazy proxy** — `Object.keys(tools)` returns `[]`. Use `tools.search()` or `tools.executor.sources.list()` to discover tools.
- **Pass objects to system tools** — `tools.search()`, `tools.describe.tool()`, and `tools.executor.sources.list()` all require object arguments.
- **Use describe before calling** — Check `inputTypeScript` to see exact parameters needed.