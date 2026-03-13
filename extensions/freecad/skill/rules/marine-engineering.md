# Marine engineering object types in this codebase

The NLP parser and geometry handler include specialized object types for
offshore and marine applications. Use the correct type names when working with
`src/nlp/parser.py` or extending the agent for marine use cases.

## Supported vessel/component types

```python
# ObjectType enum values for marine objects
ObjectType.HULL       # Ship hull geometry
ObjectType.BEAM       # Structural beams
ObjectType.PLATE      # Shell plating

# Standards configured in agent_config.json
"standards": ["DNV", "ABS", "API"]

# Vessel types
"vessel_types": ["FPSO", "FSO", "FLNG", "Semi-sub", "TLP", "Spar"]

# Analysis types
"analysis_types": ["stability", "mooring", "structural", "hydrodynamic"]
```

## Creating a hull via natural language

```bash
freecad_prompt: "Create a hull with 150m length and 25m beam"
```

The NLP parser extracts `length` and `beam` as parameters and maps to the
`HULL` object type with `CommandIntent.CREATE_OBJECT`.

## FEM preprocessing

The agent supports automated mesh generation. Call via `agent.execute_prompt`:

```python
agent.execute_prompt("Generate FEM mesh for hull with element size 0.5m")
```

Integration with OrcaFlex and AQWA is configured in `agent_config.json` under
`integrations`. Enable those agents by setting their `enabled: true` and
ensuring the sibling agent directories exist.
