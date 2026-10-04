"""Tiny JSON-Schema (2020-12 subset) validator, enough for overrides/schema.json:
$ref (local), oneOf/anyOf/allOf/not, if/then, type, enum, const, required, properties,
additionalProperties, items, prefixItems, minItems, maxItems, minimum, maximum,
minLength, pattern. Returns a list of error strings (empty = valid)."""
from __future__ import annotations

import re

TYPES = {'object': dict, 'array': list, 'string': str, 'boolean': bool, 'null': type(None)}


def _type_ok(v, t) -> bool:
    if t == 'integer':
        return isinstance(v, int) and not isinstance(v, bool)
    if t == 'number':
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    return isinstance(v, TYPES[t])


def validate(inst, schema: dict, root: dict | None = None, path: str = '') -> list[str]:
    root = root or schema
    errs: list[str] = []
    if '$ref' in schema:
        ref = schema['$ref']
        node = root
        for part in ref.lstrip('#/').split('/'):
            node = node[part]
        errs += validate(inst, node, root, path)
    if 'type' in schema:
        ts = schema['type'] if isinstance(schema['type'], list) else [schema['type']]
        if not any(_type_ok(inst, t) for t in ts):
            return errs + [f'{path or "/"}: expected {schema["type"]}']
    if 'const' in schema and inst != schema['const']:
        errs.append(f'{path or "/"}: expected const {schema["const"]!r}')
    if 'enum' in schema and inst not in schema['enum']:
        errs.append(f'{path or "/"}: {inst!r} not in {schema["enum"]}')
    if 'not' in schema and not validate(inst, schema['not'], root, path):
        errs.append(f'{path or "/"}: matches a forbidden schema')
    for sub in schema.get('allOf', []):
        errs += validate(inst, sub, root, path)
    if 'oneOf' in schema:
        ok = [s for s in schema['oneOf'] if not validate(inst, s, root, path)]
        if len(ok) != 1:
            errs.append(f'{path or "/"}: matches {len(ok)} of oneOf')
    if 'anyOf' in schema and not any(not validate(inst, s, root, path) for s in schema['anyOf']):
        errs.append(f'{path or "/"}: matches none of anyOf')
    if 'if' in schema and not validate(inst, schema['if'], root, path):
        if 'then' in schema:
            errs += validate(inst, schema['then'], root, path)
    elif 'if' in schema and 'else' in schema:
        errs += validate(inst, schema['else'], root, path)
    if isinstance(inst, dict):
        for k in schema.get('required', []):
            if k not in inst:
                errs.append(f'{path}/{k}: required')
        props = schema.get('properties', {})
        for k, v in inst.items():
            if k in props:
                errs += validate(v, props[k], root, f'{path}/{k}')
            elif schema.get('additionalProperties') is False:
                errs.append(f'{path}/{k}: additional property')
    if isinstance(inst, list):
        pre = schema.get('prefixItems', [])
        for i, v in enumerate(inst):
            if i < len(pre):
                errs += validate(v, pre[i], root, f'{path}/{i}')
            elif 'items' in schema:
                errs += validate(v, schema['items'], root, f'{path}/{i}')
        if 'minItems' in schema and len(inst) < schema['minItems']:
            errs.append(f'{path}: fewer than {schema["minItems"]} items')
        if 'maxItems' in schema and len(inst) > schema['maxItems']:
            errs.append(f'{path}: more than {schema["maxItems"]} items')
    if isinstance(inst, str):
        if 'minLength' in schema and len(inst) < schema['minLength']:
            errs.append(f'{path}: shorter than {schema["minLength"]}')
        if 'pattern' in schema and not re.search(schema['pattern'], inst):
            errs.append(f'{path}: {inst!r} does not match {schema["pattern"]}')
    if isinstance(inst, (int, float)) and not isinstance(inst, bool):
        if 'minimum' in schema and inst < schema['minimum']:
            errs.append(f'{path}: below {schema["minimum"]}')
        if 'maximum' in schema and inst > schema['maximum']:
            errs.append(f'{path}: above {schema["maximum"]}')
    return errs
